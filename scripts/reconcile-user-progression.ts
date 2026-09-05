// scripts/reconcile-user-progression.ts
//
// Development-safe repair tool: rebuilds ONE user's UserProgression from
// their currently active ResourceContribution ledger, via
// ProgressionService.recalculateUserProgression. Never creates or deletes
// StudentResource, DailyGoal, or ResourceContribution rows — those are the
// source of truth this script reconciles UserProgression against, not
// things it's allowed to touch. Always prints the before/after snapshot,
// even when nothing changed, so a clean run is visibly verified rather
// than silently assumed.
//
// Usage:
//   pnpm reconcile:progression -- <userId>
//   pnpm reconcile:progression:dry-run -- <userId>   # report only, write nothing

import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { ProgressionService } from "../src/services/progressionService.js";

interface ProgressionSnapshot {
  rankId: string;
  approvedResourceCount: number;
  currentStreak: number;
  longestStreak: number;
  lastCompletedGoalDate: Date | null;
}

function printSnapshot(label: string, snapshot: ProgressionSnapshot | null) {
  if (!snapshot) {
    console.log(`${label}: (no UserProgression row yet)`);
    return;
  }
  console.log(
    `${label}: rankId=${snapshot.rankId} approvedResourceCount=${snapshot.approvedResourceCount} ` +
      `currentStreak=${snapshot.currentStreak} longestStreak=${snapshot.longestStreak} ` +
      `lastCompletedGoalDate=${snapshot.lastCompletedGoalDate?.toISOString().slice(0, 10) ?? "null"}`
  );
}

// Signals a dry-run recalculation completed successfully; thrown to force
// the transaction to roll back without committing any write.
class DryRunRollback extends Error {
  result: ProgressionSnapshot;
  constructor(result: ProgressionSnapshot) {
    super("dry-run rollback");
    this.result = result;
  }
}

async function getAfterSnapshot(userId: string, dryRun: boolean): Promise<ProgressionSnapshot> {
  if (!dryRun) {
    return prisma.$transaction((tx) => ProgressionService.recalculateUserProgression(tx, userId), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const result = await ProgressionService.recalculateUserProgression(tx, userId);
      throw new DryRunRollback(result);
    });
  } catch (err) {
    if (err instanceof DryRunRollback) {
      return err.result;
    }
    throw err;
  }
  // Unreachable — the transaction above always throws before committing.
  throw new Error("Dry run did not produce a result");
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const userId = args.find((a) => !a.startsWith("--"));

  if (!userId) {
    console.error("❌ Usage: reconcile-user-progression <userId> [--dry-run]");
    console.error("   A user ID is required — this tool reconciles exactly one user per run.");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    console.error(`❌ No user found with id "${userId}". Nothing to reconcile.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n🔄 Reconciling progression for user ${userId}${dryRun ? " (dry run — no writes)" : ""}...\n`);

  const before = await prisma.userProgression.findUnique({ where: { userId } });
  const after = await getAfterSnapshot(userId, dryRun);

  printSnapshot("Before", before);
  printSnapshot("After ", after);

  const changed =
    !before ||
    before.rankId !== after.rankId ||
    before.approvedResourceCount !== after.approvedResourceCount ||
    before.currentStreak !== after.currentStreak ||
    before.longestStreak !== after.longestStreak ||
    (before.lastCompletedGoalDate?.getTime() ?? null) !== (after.lastCompletedGoalDate?.getTime() ?? null);

  console.log(
    changed
      ? dryRun
        ? "\n⚠️  Drift detected — would be updated (dry run, nothing written).\n"
        : "\n⚠️  Drift detected and corrected.\n"
      : "\n✅ Already consistent — no drift.\n"
  );
}

main()
  .catch((err) => {
    console.error("❌ Reconciliation failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
