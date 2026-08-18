import { Worker, Job } from "bullmq";
import { redisConnectionOptions } from "../../config/redis.js";
import { ResendProvider } from "../../providers/email/resend.provider.js";
import { IEmailProvider } from "../../providers/email/email.provider.js";
import { notificationCampaignRepository } from "./notification-campaign.repository.js";
import { notificationRecipientRepository } from "./notification-recipient.repository.js";
import { notificationDeliveryRepository } from "./notification-delivery.repository.js";
import { NOTIFICATION_QUEUE_NAME } from "./notification.queue.js";
import { NotificationJobData, NotificationStatus, PERMANENT_FAILURE_MARKER } from "./notification.types.js";
import { DeliveryEventType } from "@prisma/client";

const EMAIL_PROVIDER_NAME = "resend";

export class NotificationWorker {
  private worker: Worker<NotificationJobData>;
  private emailProvider: IEmailProvider;

  constructor(emailProvider?: IEmailProvider) {
    this.emailProvider = emailProvider || new ResendProvider();

    this.worker = new Worker<NotificationJobData>(
      NOTIFICATION_QUEUE_NAME,
      async (job: Job<NotificationJobData>) => {
        await this.processJob(job);
      },
      {
        connection: redisConnectionOptions as any,
        concurrency: 5,
      }
    );

    this.setupEventListeners();
  }

  private async processJob(job: Job<NotificationJobData>) {
    if (!job.data.recipients || job.data.recipients.length === 0) {
      throw new Error("[Notification Worker] Job data missing recipients");
    }
    await this.processCampaignBatchJob(job);
  }

  // Processes every recipient in the batch with its OWN try/catch — one bad
  // email must never throw out of the loop and abort delivery to the rest
  // of the batch.
  private async processCampaignBatchJob(job: Job<NotificationJobData>) {
    const { recipients, subject, body } = job.data;
    const transientFailures: { recipientId: string; recipient: string; error: string }[] = [];
    let permanentFailureCount = 0;

    for (const { recipientId, recipient } of recipients!) {
      try {
        const current = await notificationRecipientRepository.getRecipientStatus(recipientId);
        if (current?.status === NotificationStatus.DELIVERED) {
          continue;
        }
        if (current?.status === NotificationStatus.FAILED && current.lastError?.startsWith(PERMANENT_FAILURE_MARKER)) {
          continue;
        }

        await notificationRecipientRepository.updateRecipientStatus(recipientId, NotificationStatus.PROCESSING);

        const result = await this.emailProvider.sendEmail({ to: recipient, subject, html: body });

        if (!result.success) {
          const isPermanent = result.errorType === "permanent";
          const errorMsg = result.error || "Email delivery failed";
          const storedError = isPermanent ? `${PERMANENT_FAILURE_MARKER} ${errorMsg}` : errorMsg;

          await notificationRecipientRepository.updateRecipientStatus(recipientId, NotificationStatus.FAILED, {
            lastError: storedError,
          });
          await notificationDeliveryRepository.appendDeliveryEvent(recipientId, DeliveryEventType.FAILED, {
            provider: EMAIL_PROVIDER_NAME,
            metadata: { error: errorMsg, permanent: isPermanent },
          });

          if (isPermanent) {
            permanentFailureCount++;
          } else {
            transientFailures.push({ recipientId, recipient, error: errorMsg });
          }
          continue;
        }

        await notificationRecipientRepository.updateRecipientStatus(recipientId, NotificationStatus.DELIVERED, {
          providerMessageId: result.id,
          sentAt: new Date(),
        });
        await notificationDeliveryRepository.appendDeliveryEvent(recipientId, DeliveryEventType.SENT, {
          provider: EMAIL_PROVIDER_NAME,
          providerMessageId: result.id,
        });
      } catch (err: any) {
        const errorMsg = err?.message || "Unexpected error during delivery";
        console.error(`[NotificationWorker] Unexpected error delivering to ${recipient} (${recipientId}):`, err);
        try {
          await notificationRecipientRepository.updateRecipientStatus(recipientId, NotificationStatus.FAILED, {
            lastError: errorMsg,
          });
          await notificationDeliveryRepository.appendDeliveryEvent(recipientId, DeliveryEventType.FAILED, {
            provider: EMAIL_PROVIDER_NAME,
            metadata: { error: errorMsg, permanent: false },
          });
        } catch (persistErr) {
          console.error(`[NotificationWorker] Failed to persist failure state for ${recipientId}:`, persistErr);
        }
        transientFailures.push({ recipientId, recipient, error: errorMsg });
      }
    }

    if (transientFailures.length > 0) {
      throw new Error(
        `[Notification Worker] ${transientFailures.length}/${recipients!.length} deliveries failed (transient) in batch for campaign ${job.data.campaignId}` +
          (permanentFailureCount > 0 ? ` (+${permanentFailureCount} permanent, not retried)` : "") +
          `: ` +
          transientFailures.map((f) => `${f.recipient} (${f.error})`).join("; ")
      );
    }
  }

  private setupEventListeners() {
    this.worker.on("completed", async (job) => {
      const count = job.data.recipients?.length ?? 1;
      console.log(`[NotificationWorker] Job ${job.id} completed successfully (${count} recipient(s) in batch)`);
      if (job.data.campaignId) {
        await notificationCampaignRepository.maybeCompleteCampaign(job.data.campaignId);
      }
    });

    this.worker.on("failed", async (job, err) => {
      console.error(`[NotificationWorker] Job ${job?.id} failed with error: ${err.message}`);
      if (!job || !job.data.campaignId) return;

      const totalAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= totalAttempts) {
        await notificationCampaignRepository.maybeCompleteCampaign(job.data.campaignId);
      }
    });
  }

  async close() {
    await this.worker.close();
  }
}

export const initNotificationWorker = () => new NotificationWorker();
