import { prisma } from "../../lib/prisma.js";
import { CampaignStatus, NotificationChannel, NotificationStatus, NotificationType, Prisma } from "@prisma/client";

// Any DB client capable of running these queries — either the global
// singleton or a transaction client handed in by a caller composing this
// repository with another one inside a single prisma.$transaction.
type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Campaign & Notification CRUD & status tracking.
 */
export class NotificationCampaignRepository {
  /**
   * Inserts a single NotificationCampaign row (broadcast, transactional, or system).
   */
  async createCampaign(
    params: {
      title: string;
      subject?: string | null;
      message: string;
      targetLevels?: string[];
      targetDepartments?: string[];
      channel?: NotificationChannel;
      type?: NotificationType;
      idempotencyKey?: string | null;
      metadata?: Record<string, any>;
      createdByAdminId?: string | null;
      recipientCount: number;
    },
    db: Db = prisma
  ) {
    return db.notificationCampaign.create({
      data: {
        type: params.type ?? NotificationType.BROADCAST,
        idempotencyKey: params.idempotencyKey ?? null,
        title: params.title,
        subject: params.subject ?? params.title,
        message: params.message,
        targetLevels: params.targetLevels ?? [],
        targetDepartments: params.targetDepartments ?? [],
        channel: params.channel ?? NotificationChannel.EMAIL,
        metadata: params.metadata ?? {},
        createdByAdminId: params.createdByAdminId ?? null,
        recipientCount: params.recipientCount,
        status: CampaignStatus.QUEUED,
      },
    });
  }

  async findByIdempotencyKey(idempotencyKey: string, db: Db = prisma) {
    return db.notificationCampaign.findUnique({
      where: { idempotencyKey },
      include: {
        recipients: true,
      },
    });
  }

  async findById(id: string, db: Db = prisma) {
    return db.notificationCampaign.findUnique({
      where: { id },
      include: {
        recipients: true,
      },
    });
  }

  /**
   * Corrects recipientCount to an authoritative value.
   */
  async updateRecipientCount(campaignId: string, count: number, db: Db = prisma) {
    return db.notificationCampaign.update({
      where: { id: campaignId },
      data: { recipientCount: count },
    });
  }

  async markCampaignStatus(campaignId: string, status: CampaignStatus, completedAt?: Date, db: Db = prisma) {
    return db.notificationCampaign.update({
      where: { id: campaignId },
      data: { status, ...(completedAt ? { completedAt } : {}) },
    });
  }

  async maybeCompleteCampaign(campaignId: string) {
    const [total, pending] = await Promise.all([
      prisma.notificationRecipient.count({ where: { campaignId } }),
      prisma.notificationRecipient.count({
        where: {
          campaignId,
          status: { in: [NotificationStatus.PENDING, NotificationStatus.QUEUED, NotificationStatus.PROCESSING] },
        },
      }),
    ]);

    if (total === 0 || pending > 0) return;

    const failed = await prisma.notificationRecipient.count({
      where: { campaignId, status: NotificationStatus.FAILED },
    });

    await this.markCampaignStatus(
      campaignId,
      failed === total ? CampaignStatus.FAILED : CampaignStatus.COMPLETED,
      new Date()
    );
  }
}

export const notificationCampaignRepository = new NotificationCampaignRepository();
