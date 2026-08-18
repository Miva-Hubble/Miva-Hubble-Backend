import { Queue } from "bullmq";
import { redisConnectionOptions } from "../../config/redis.js";
import { NotificationJobData, QUEUE_PRIORITY_BROADCAST } from "./notification.types.js";

export const NOTIFICATION_QUEUE_NAME = "notifications-delivery";

export class NotificationQueue {
  private queue: Queue<NotificationJobData>;

  constructor() {
    this.queue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE_NAME, {
      connection: redisConnectionOptions as any,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 3000, // Initial delay 3s, then 6s, 12s, 24s...
        },
        removeOnComplete: { age: 86400, count: 1000 }, // Keep completed jobs up to 24h
        removeOnFail: { age: 604800, count: 5000 },    // Keep failed jobs up to 7 days
      },
    });
  }

  async addJob(data: NotificationJobData) {
    return this.queue.add("deliver-notification", data, {
      jobId: `${data.campaignId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      priority: data.priority ?? QUEUE_PRIORITY_BROADCAST,
    });
  }

  async addBulkJobs(jobsData: NotificationJobData[]) {
    return this.queue.addBulk(
      jobsData.map((data, index) => ({
        name: "deliver-notification",
        data,
        opts: {
          jobId: `${data.campaignId}:${Date.now()}:${index}`,
          priority: data.priority ?? QUEUE_PRIORITY_BROADCAST,
        },
      }))
    );
  }

  async getQueueStatus() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }
}

export const notificationQueue = new NotificationQueue();
