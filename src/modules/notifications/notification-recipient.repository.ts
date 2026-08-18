import { prisma } from "../../lib/prisma.js";
import { NotificationStatus, Prisma } from "@prisma/client";
import { TARGET_ALL } from "./notification.types.js";


type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Recipient eligibility query & bulk insert, plus per-recipient status
 * tracking. Split out from the old monolithic
 * notification-campaign.repository.ts — campaign-row CRUD lives there,
 * delivery-event appending lives in notification-delivery.repository.ts.
 */
export class NotificationRecipientRepository {
  // Targeting happens in SQL — a single indexed query against User+Onboarding,
  // never "fetch everyone then filter in application code".
  //
  // `TARGET_ALL` ("All") in either array means "don't filter on this
  // dimension" — it is NOT a literal onboarding.level/department value any
  // real student has, so passing it straight into `{ in: [...] }` would
  // silently match zero users. This mirrors the wildcard convention already
  // used for Book targeting (see StorageService.getPersonalizedFeed), just
  // expressed as "omit the filter" instead of "OR against the literal
  // string", since Onboarding has no analogous `level = "All"` row to match
  // against on the user side.
  async findEligibleUsersByLevels(levels: string[], departments?: string[]) {
    const allLevels = levels.includes(TARGET_ALL);
    const allDepartments = !departments || departments.length === 0 || departments.includes(TARGET_ALL);

    return prisma.user.findMany({
      where: {
        onboarding: {
          ...(allLevels ? {} : { level: { in: levels } }),
          ...(allDepartments ? {} : { department: { in: departments! } }),
        },
      },
      select: { id: true, email: true },
    });
  }

  /**
   * Bulk-inserts one NotificationRecipient row per eligible user, then
   * re-reads the persisted rows and returns them (so the caller gets real
   * recipient IDs, not just an insert count).
   *
   * Accepts an optional transaction client so NotificationService can
   * compose this with NotificationCampaignRepository.createCampaign inside
   * one atomic prisma.$transaction — recipient rows must never commit
   * without their parent campaign row, or vice versa.
   */
  async bulkInsertRecipients(campaignId: string, users: { id: string; email: string }[], db: Db = prisma) {
    await db.notificationRecipient.createMany({
      data: users.map((u) => ({
        campaignId,
        userId: u.id,
        email: u.email,
      })),
    });

    return db.notificationRecipient.findMany({
      where: { campaignId },
      select: { id: true, userId: true, email: true },
    });
  }

  async countByCampaign(campaignId: string, db: Db = prisma) {
    return db.notificationRecipient.count({ where: { campaignId } });
  }

  /**
   * Recomputes recipientCount from an authoritative COUNT(*) against
   * notification_recipients and writes it back to the parent campaign row
   * (via NotificationCampaignRepository — this is the one place this
   * repository reaches across the split, since "keep the campaign's count
   * in sync" is inherently a cross-table operation). The transactional
   * creation path (NotificationService.dispatchNotification) already keeps
   * the two in sync at creation time — this is the reconciliation escape
   * hatch for anything that could desync them later: manual DB
   * intervention, a restored backup, a future bulk-insert path that
   * bypasses this repository, etc.
   */
  async recalculateRecipientCount(campaignId: string, db: Db = prisma) {
    const count = await this.countByCampaign(campaignId, db);
    await db.notificationCampaign.update({
      where: { id: campaignId },
      data: { recipientCount: count },
    });
    return count;
  }

  /**
   * Cheap status/lastError-only lookup, used by the worker as a
   * skip-on-retry guard when a batch job is retried:
   *  - already DELIVERED — some OTHER recipient in the batch is what
   *    caused the retry; don't re-send to this one.
   *  - already FAILED with a lastError carrying the PERMANENT_FAILURE_MARKER
   *    prefix (see notification.worker.ts) — a prior attempt already
   *    determined this exact send can never succeed (bad address,
   *    validation error, etc.); don't burn another retry attempt on it.
   * A plain FAILED (transient, no marker) is NOT skipped — that's exactly
   * the case a retry exists to give another chance.
   */
  async getRecipientStatus(recipientId: string, db: Db = prisma) {
    const row = await db.notificationRecipient.findUnique({
      where: { id: recipientId },
      select: { status: true, lastError: true },
    });
    return row ?? null;
  }

  async updateRecipientStatus(
    recipientId: string,
    status: NotificationStatus,
    extra?: { lastError?: string; providerMessageId?: string; sentAt?: Date },
    db: Db = prisma
  ) {
    // updatedAt is stamped automatically (Prisma @updatedAt on
    // NotificationRecipient) on every call here — this is what lets an
    // operator query "recipients where status = PROCESSING AND updatedAt < now() - interval '20 minutes'" to find stuck jobs directly, instead
    // of reconstructing the timeline from notification_delivery_events.
    return db.notificationRecipient.update({
      where: { id: recipientId },
      data: {
        status,
        ...(status === NotificationStatus.PROCESSING ? { attempts: { increment: 1 } } : {}),
        ...(extra?.lastError !== undefined && { lastError: extra.lastError }),
        ...(extra?.providerMessageId !== undefined && { providerMessageId: extra.providerMessageId }),
        ...(extra?.sentAt !== undefined && { sentAt: extra.sentAt }),
      },
    });
  }

  // Student-facing feed: notifications received via an admin campaign.
  // NotificationRecipient has no createdAt of its own (all recipients for a
  // campaign are created together, atomically) — order by the parent
  // campaign's createdAt instead.
  async findByUserId(userId: string, limit = 20, db: Db = prisma) {
    return db.notificationRecipient.findMany({
      where: { userId },
      include: {
        campaign: { select: { title: true, subject: true, message: true, channel: true, createdAt: true } },
      },
      orderBy: { campaign: { createdAt: "desc" } },
      take: limit,
    });
  }

  async findById(id: string, db: Db = prisma) {
    return db.notificationRecipient.findUnique({
      where: { id },
      include: {
        campaign: { select: { title: true, subject: true, message: true, channel: true, createdAt: true } },
      },
    });
  }
}

export const notificationRecipientRepository = new NotificationRecipientRepository();
