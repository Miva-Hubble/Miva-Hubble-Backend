import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { outboxRepository } from "../src/modules/notifications/outbox.repository.js";
import { notificationCampaignRepository } from "../src/modules/notifications/notification-campaign.repository.js";
import { CampaignStatus, NotificationStatus, OutboxJobStatus } from "@prisma/client";

const NOTIFICATION_BATCH_SIZE = 100;
const STUCK_THRESHOLD_MINUTES = 5;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

interface ReconcileResult {
  campaignId: string;
  title: string;
  status: CampaignStatus;
  createdAt: Date;
  totalRecipients: number;
  deliveredCount: number;
  failedCount: number;
  pendingCount: number;
  actionTaken: string;
}

export async function reconcileStuckCampaigns(autoFix = false): Promise<ReconcileResult[]> {
  const thresholdDate = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000);

  console.log(`\n🔍 Searching for campaigns stuck in QUEUED / PROCESSING created before ${thresholdDate.toISOString()}...`);

  const stuckCampaigns = await prisma.notificationCampaign.findMany({
    where: {
      status: { in: [CampaignStatus.QUEUED, CampaignStatus.PROCESSING] },
      createdAt: { lt: thresholdDate },
    },
    include: {
      recipients: true,
      outboxJobs: true,
    },
  });

  if (stuckCampaigns.length === 0) {
    console.log("✅ No stuck campaigns found.");
    return [];
  }

  console.log(`⚠️ Found ${stuckCampaigns.length} potentially stuck campaign(s).\n`);
  const results: ReconcileResult[] = [];

  for (const campaign of stuckCampaigns) {
    const total = campaign.recipients.length;
    const delivered = campaign.recipients.filter((r) => r.status === NotificationStatus.DELIVERED).length;
    const failed = campaign.recipients.filter((r) => r.status === NotificationStatus.FAILED).length;
    const pending = campaign.recipients.filter(
      (r) => r.status === NotificationStatus.PENDING || r.status === NotificationStatus.PROCESSING || r.status === NotificationStatus.QUEUED
    );

    const pendingOutboxJobs = campaign.outboxJobs.filter((job) => job.status === OutboxJobStatus.PENDING);
    let actionTaken = "None (dry-run)";

    // Case 1: All recipients are already in terminal state -> campaign should be COMPLETED/FAILED
    if (pending.length === 0 && total > 0) {
      if (autoFix) {
        await notificationCampaignRepository.maybeCompleteCampaign(campaign.id);
        actionTaken = "Resolved to terminal state (COMPLETED/FAILED)";
      } else {
        actionTaken = "Ready to resolve (all recipients finished, campaign needs status update)";
      }
    }
    // Case 2: Outbox job was never created or all outbox jobs failed -> recreate outbox job for remaining pending recipients
    else if (pendingOutboxJobs.length === 0 && pending.length > 0) {
      if (autoFix) {
        const batches = chunk(pending, NOTIFICATION_BATCH_SIZE);
        const payload = {
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
            metadata: (campaign.metadata as Record<string, any>) || {},
          })),
        };

        await outboxRepository.createJob(campaign.id, payload);
        actionTaken = `Enqueued recovery OutboxJob with ${pending.length} pending recipient(s)`;
      } else {
        actionTaken = `Needs OutboxJob recovery for ${pending.length} pending recipient(s)`;
      }
    } else {
      actionTaken = `Has active pending outbox job (${pendingOutboxJobs.length} job(s))`;
    }

    results.push({
      campaignId: campaign.id,
      title: campaign.title,
      status: campaign.status,
      createdAt: campaign.createdAt,
      totalRecipients: total,
      deliveredCount: delivered,
      failedCount: failed,
      pendingCount: pending.length,
      actionTaken,
    });
  }

  // Summary Table
  console.table(
    results.map((r) => ({
      "Campaign ID": r.campaignId,
      Title: r.title.slice(0, 25),
      Status: r.status,
      Total: r.totalRecipients,
      Delivered: r.deliveredCount,
      Failed: r.failedCount,
      Pending: r.pendingCount,
      Action: r.actionTaken,
    }))
  );

  return results;
}

// CLI execution
if (process.argv[1]?.includes("reconcile-stuck-campaigns")) {
  const autoFix = process.argv.includes("--fix");
  console.log(`Starting campaign reconciliation (mode: ${autoFix ? "AUTO-FIX" : "DRY-RUN, pass --fix to apply repairs"})...`);

  reconcileStuckCampaigns(autoFix)
    .then(() => {
      console.log("\nReconciliation check finished successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n❌ Reconciliation check failed:", err);
      process.exit(1);
    });
}
