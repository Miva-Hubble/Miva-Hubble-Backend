import { outboxRepository } from "./outbox.repository.js";
import { notificationQueue } from "./notification.queue.js";
import { notificationCampaignRepository } from "./notification-campaign.repository.js";
import { CampaignStatus, OutboxJob } from "@prisma/client";
import { NotificationJobData } from "./notification.types.js";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 5;

export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isRunning = false;
  private pollIntervalMs: number;

  constructor(pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS) {
    this.pollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS) || pollIntervalMs;
  }

  /**
   * Starts the polling loop for pending outbox jobs.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`⚡ Outbox Worker started (polling every ${this.pollIntervalMs}ms)`);

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.processPendingJobs();
      } catch (err) {
        console.error("[OutboxWorker] Error during poll execution:", err);
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(poll, this.pollIntervalMs);
        }
      }
    };

    this.timer = setTimeout(poll, 100);
  }

  /**
   * Stops the polling loop and awaits completion of any in-flight cycle.
   */
  async stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Wait for in-flight processing to complete if currently busy
    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    console.log("✅ Outbox Worker stopped");
  }

  /**
   * Fetches and enqueues all pending outbox jobs into BullMQ.
   */
  async processPendingJobs(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    let processedCount = 0;
    try {
      const pendingJobs = await outboxRepository.fetchPending(20);
      if (pendingJobs.length === 0) {
        return 0;
      }

      for (const job of pendingJobs) {
        await this.processJob(job);
        processedCount++;
      }
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  private async processJob(job: OutboxJob) {
    try {
      const payload = job.payload as unknown as {
        campaignId: string;
        batches: NotificationJobData[];
      };

      if (!payload || !Array.isArray(payload.batches)) {
        throw new Error(`Invalid outbox job payload structure for job ${job.id}`);
      }

      // 1. Enqueue to BullMQ
      await notificationQueue.addBulkJobs(payload.batches);

      // 2. Mark OutboxJob as COMPLETED
      await outboxRepository.markCompleted(job.id);

      // 3. Mark campaign status as PROCESSING
      await notificationCampaignRepository.markCampaignStatus(
        job.campaignId,
        CampaignStatus.PROCESSING
      );

      console.log(
        `[OutboxWorker] Successfully dispatched outbox job ${job.id} for campaign ${job.campaignId} (${payload.batches.length} batch(es))`
      );
    } catch (err: any) {
      const errorMsg = err?.message || "Failed to enqueue outbox job to BullMQ";
      console.error(
        `[OutboxWorker] Error processing outbox job ${job.id} for campaign ${job.campaignId}:`,
        err
      );

      await outboxRepository.markFailed(job.id, errorMsg);

      if (job.attempts + 1 >= MAX_ATTEMPTS) {
        console.error(
          `[OutboxWorker] Outbox job ${job.id} reached max attempts (${MAX_ATTEMPTS}). Marking campaign ${job.campaignId} as FAILED.`
        );
        await notificationCampaignRepository.markCampaignStatus(
          job.campaignId,
          CampaignStatus.FAILED,
          new Date()
        );
      }
    }
  }
}

export const outboxWorker = new OutboxWorker();
export const initOutboxWorker = () => {
  outboxWorker.start();
  return outboxWorker;
};
