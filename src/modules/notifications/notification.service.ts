import {
  CreateNotificationDTO,
  SendTransactionalNotificationDTO,
  NotificationBatchRecipient,
  NOTIFICATION_BATCH_SIZE,
  QUEUE_PRIORITY_TRANSACTIONAL,
  QUEUE_PRIORITY_BROADCAST,
} from "./notification.types.js";
import { notificationCampaignRepository } from "./notification-campaign.repository.js";
import { notificationRecipientRepository } from "./notification-recipient.repository.js";
import { outboxRepository } from "./outbox.repository.js";
import { prisma } from "../../lib/prisma.js";
import { CampaignStatus, NotificationChannel, NotificationType } from "@prisma/client";

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export class NotificationService {
  /**
   * Admin bulk-send by student level (Broadcast).
   * Resolves eligible students via a single SQL query, creates the campaign,
   * every recipient row, and the transactional OutboxJob in one ACID transaction.
   *
   * @param input Client-supplied, Zod-validated payload.
   * @param createdByAdminId Server-derived from the authenticated admin's token.
   */
  async dispatchNotification(input: CreateNotificationDTO, createdByAdminId?: string) {
    if (!createdByAdminId) {
      const error = new Error("createdByAdminId is required to dispatch a campaign");
      (error as any).status = 401;
      throw error;
    }

    // 1. Resolve eligible students in SQL — never fetch-then-filter in app code.
    const eligibleUsers = await notificationRecipientRepository.findEligibleUsersByLevels(
      input.targetLevels,
      input.targetDepartments
    );

    if (eligibleUsers.length === 0) {
      const error = new Error(`No eligible students found for levels: ${input.targetLevels.join(", ")}`);
      (error as any).status = 400;
      throw error;
    }

    // 2. Create the campaign row + all recipient rows + outbox job in ONE transaction.
    const { campaign, recipients } = await prisma.$transaction(async (tx) => {
      const provisionalCampaign = await notificationCampaignRepository.createCampaign(
        {
          type: NotificationType.BROADCAST,
          title: input.title,
          subject: input.title,
          message: input.message,
          targetLevels: input.targetLevels,
          targetDepartments: input.targetDepartments || [],
          channel: NotificationChannel.EMAIL,
          metadata: input.metadata || {},
          createdByAdminId,
          recipientCount: eligibleUsers.length,
        },
        tx
      );

      const recipients = await notificationRecipientRepository.bulkInsertRecipients(
        provisionalCampaign.id,
        eligibleUsers,
        tx
      );

      const actualCount = recipients.length;
      let campaign = provisionalCampaign;
      if (actualCount !== provisionalCampaign.recipientCount) {
        console.warn(
          `[NotificationService] recipientCount mismatch for campaign ${provisionalCampaign.id}: ` +
            `expected ${provisionalCampaign.recipientCount} eligible users but ${actualCount} recipient rows were persisted. ` +
            `Correcting recipientCount to the persisted value before commit.`
        );
        campaign = await notificationCampaignRepository.updateRecipientCount(provisionalCampaign.id, actualCount, tx);
      }

      campaign = await notificationCampaignRepository.markCampaignStatus(
        campaign.id,
        CampaignStatus.QUEUED,
        undefined,
        tx
      );

      // Construct batch payloads for BullMQ with NORMAL priority
      const batches = chunk(recipients, NOTIFICATION_BATCH_SIZE);
      const outboxPayload = {
        campaignId: campaign.id,
        batches: batches.map((batch) => ({
          campaignId: campaign.id,
          recipients: batch.map((recipient) => ({
            recipientId: recipient.id,
            recipient: recipient.email,
            userId: recipient.userId || undefined,
          })),
          subject: campaign.subject ?? campaign.title,
          body: campaign.message,
          channel: campaign.channel,
          metadata: (campaign.metadata as Record<string, any>) || {},
          priority: QUEUE_PRIORITY_BROADCAST,
        })),
      };

      await outboxRepository.createJob(campaign.id, outboxPayload, tx);

      return { campaign, recipients };
    });

    return {
      campaignId: campaign.id,
      queuedCount: recipients.length,
      targetLevels: input.targetLevels,
    };
  }

  /**
   * Transactional single-recipient notification (e.g., Welcome Email, Password Reset).
   * Creates a 1-recipient Notification row + Recipient row + Outbox Job in an ACID transaction.
   * Guarantees idempotency via `idempotencyKey` so duplicate events do not double-send.
   */
  async sendTransactionalNotification(input: SendTransactionalNotificationDTO) {
    if (!input.userId || !input.email) {
      throw new Error("userId and email are required for transactional notifications");
    }

    // 1. Check idempotency key if provided
    if (input.idempotencyKey) {
      const existing = await notificationCampaignRepository.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        console.log(
          `[NotificationService] Idempotency key '${input.idempotencyKey}' already processed. Returning existing notification ${existing.id}.`
        );
        return {
          campaignId: existing.id,
          queuedCount: existing.recipientCount,
          duplicate: true,
        };
      }
    }

    // 2. Insert notification + recipient + outbox job in one transaction
    const { campaign, recipient } = await prisma.$transaction(async (tx) => {
      const campaign = await notificationCampaignRepository.createCampaign(
        {
          type: input.type ?? NotificationType.TRANSACTIONAL,
          idempotencyKey: input.idempotencyKey ?? null,
          title: input.title,
          subject: input.subject ?? input.title,
          message: input.message,
          targetLevels: [],
          targetDepartments: [],
          channel: input.channel ?? NotificationChannel.EMAIL,
          metadata: input.metadata || {},
          createdByAdminId: null,
          recipientCount: 1,
        },
        tx
      );

      const insertedRecipients = await notificationRecipientRepository.bulkInsertRecipients(
        campaign.id,
        [{ id: input.userId, email: input.email }],
        tx
      );

      const recipient = insertedRecipients[0];

      // Mark campaign as QUEUED within transaction
      await notificationCampaignRepository.markCampaignStatus(
        campaign.id,
        CampaignStatus.QUEUED,
        undefined,
        tx
      );

      // Create outbox job with HIGH priority (priority: 1)
      const outboxPayload = {
        campaignId: campaign.id,
        batches: [
          {
            campaignId: campaign.id,
            recipients: [
              {
                recipientId: recipient.id,
                recipient: recipient.email,
                userId: input.userId,
              },
            ],
            subject: campaign.subject ?? campaign.title,
            body: campaign.message,
            channel: campaign.channel,
            metadata: (campaign.metadata as Record<string, any>) || {},
            priority: QUEUE_PRIORITY_TRANSACTIONAL,
          },
        ],
      };

      await outboxRepository.createJob(campaign.id, outboxPayload, tx);

      return { campaign, recipient };
    });

    return {
      campaignId: campaign.id,
      recipientId: recipient.id,
      queuedCount: 1,
    };
  }

  // Student-facing: a single notification status lookup
  async getNotificationStatus(id: string) {
    const recipient = await notificationRecipientRepository.findById(id);
    if (!recipient) {
      throw new Error("Notification not found");
    }
    return recipient;
  }

  // Student-facing unified notification feed (broadcasts + transactional welcome/system)
  async getUserNotifications(userId: string) {
    return notificationRecipientRepository.findByUserId(userId);
  }
}

export const notificationService = new NotificationService();
