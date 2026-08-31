// src/queues/bookAnalytics.queue.ts

import { Queue, Worker, Job } from "bullmq";
import { redisConnectionOptions } from "../config/redis.js";
import prisma from "../lib/prisma.js";

export const BOOK_ANALYTICS_QUEUE_NAME = "book-analytics";

export interface BookAnalyticsJobData {
  userId: string;
  bookId: string;
  type: "DOWNLOAD" | "PREVIEW";
  timestamp: string;
}

/**
 * BullMQ Queue for reliable, asynchronous tracking of book engagement metrics.
 * Configured with exponential backoff retries so database locks or connection drops
 * never lose metrics.
 */
export class BookAnalyticsQueue {
  private queue: Queue<BookAnalyticsJobData>;

  constructor() {
    this.queue = new Queue<BookAnalyticsJobData>(BOOK_ANALYTICS_QUEUE_NAME, {
      connection: redisConnectionOptions as any,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 2000, // 2s, 4s, 8s, 16s...
        },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 2000 },
      },
    });
  }

  /**
   * Enqueues an engagement event without blocking the user response.
   */
  async trackEngagement(data: BookAnalyticsJobData): Promise<void> {
    await this.queue.add("record-engagement", data, {
      jobId: `${data.type.toLowerCase()}:${data.userId}:${data.bookId}:${Date.now()}`,
    });
  }
}

export const bookAnalyticsQueue = new BookAnalyticsQueue();

/**
 * Worker processor that safely executes idempotent metric recording.
 */
export function initBookAnalyticsWorker() {
  const worker = new Worker<BookAnalyticsJobData>(
    BOOK_ANALYTICS_QUEUE_NAME,
    async (job: Job<BookAnalyticsJobData>) => {
      const { userId, bookId, type } = job.data;

      if (type === "DOWNLOAD") {
        await processDownload(userId, bookId);
      } else if (type === "PREVIEW") {
        await processPreview(userId, bookId);
      }
    },
    {
      connection: redisConnectionOptions as any,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[BookAnalyticsWorker] Job ${job?.id} failed on attempt ${job?.attemptsMade}:`, err);
  });

  return worker;
}

async function processDownload(userId: string, bookId: string) {
  const existing = await prisma.bookDownload.findUnique({
    where: {
      userId_bookId: {
        userId,
        bookId,
      },
    },
    select: { id: true },
  });

  if (!existing) {
    await prisma.$transaction([
      prisma.bookDownload.create({
        data: {
          userId,
          bookId,
        },
      }),
      prisma.book.update({
        where: { id: bookId },
        data: { downloadCount: { increment: 1 } },
      }),
    ]);
  } else {
    await prisma.bookDownload.update({
      where: {
        userId_bookId: {
          userId,
          bookId,
        },
      },
      data: {
        lastDownloadedAt: new Date(),
      },
    });
  }
}

async function processPreview(userId: string, bookId: string) {
  const existing = await prisma.bookView.findUnique({
    where: {
      userId_bookId: {
        userId,
        bookId,
      },
    },
    select: { id: true },
  });

  if (!existing) {
    await prisma.$transaction([
      prisma.bookView.create({
        data: {
          userId,
          bookId,
        },
      }),
      prisma.book.update({
        where: { id: bookId },
        data: { previewCount: { increment: 1 } },
      }),
    ]);
  } else {
    await prisma.bookView.update({
      where: {
        userId_bookId: {
          userId,
          bookId,
        },
      },
      data: {
        lastViewedAt: new Date(),
      },
    });
  }
}
