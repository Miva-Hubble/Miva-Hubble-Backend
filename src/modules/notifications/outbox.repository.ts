import { prisma } from "../../lib/prisma.js";
import { OutboxJob, OutboxJobStatus, Prisma } from "@prisma/client";

type Db = typeof prisma | Prisma.TransactionClient;

export class OutboxRepository {
  /** Create a new outbox job within a transaction or standalone */
  async createJob(
    campaignId: string,
    payload: any,
    db: Db = prisma
  ): Promise<OutboxJob> {
    return db.outboxJob.create({
      data: {
        campaignId,
        payload,
        status: OutboxJobStatus.PENDING,
      },
    });
  }

  /** Mark a job as completed */
  async markCompleted(id: string, db: Db = prisma): Promise<void> {
    await db.outboxJob.update({
      where: { id },
      data: { status: OutboxJobStatus.COMPLETED },
    });
  }

  /** Mark a job as failed with error */
  async markFailed(id: string, error: string, db: Db = prisma): Promise<void> {
    await db.outboxJob.update({
      where: { id },
      data: {
        status: OutboxJobStatus.FAILED,
        lastError: error,
        attempts: { increment: 1 },
      },
    });
  }

  /** Fetch pending jobs (limit optional) */
  async fetchPending(limit = 50, db: Db = prisma): Promise<OutboxJob[]> {
    return db.outboxJob.findMany({
      where: { status: OutboxJobStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  /** Find outbox job by campaignId */
  async findByCampaignId(campaignId: string, db: Db = prisma): Promise<OutboxJob[]> {
    return db.outboxJob.findMany({
      where: { campaignId },
      orderBy: { createdAt: "asc" },
    });
  }
}

export const outboxRepository = new OutboxRepository();
