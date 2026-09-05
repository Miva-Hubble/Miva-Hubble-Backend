// scripts/test-gate8-progression.ts
//
// Direct integration tests against ProgressionService (Gate 8). No HTTP —
// Gate 8 explicitly does not add API routes yet, so this calls
// recalculateUserProgression / getDailyGoalForDate / getRollingConsistency
// directly against a real database, the same way Gate 6/7's scripts do.

import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { ProgressionService } from "../src/services/progressionService.js";
import { getLagosCalendarDate } from "../src/lib/lagosTime.js";
import { StudentResourceStatus, StudentResourceType, FileFormat } from "../src/services/studentResourceService.js";
import { seedRankDefinitions } from "./seed-rank-definitions.js";
import { randomUUID } from "crypto";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✅ Passed: ${message}`);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Lagos-calendar-normalized date, N days before the real current instant. */
function daysAgo(n: number): Date {
  return getLagosCalendarDate(new Date(Date.now() - n * ONE_DAY_MS));
}

async function makeUser(idPrefix: string, createdAt?: Date) {
  const id = `${idPrefix}-${randomUUID().slice(0, 8)}`;
  return prisma.user.create({
    data: {
      id,
      name: idPrefix,
      username: id,
      email: `${id}@miva.edu.ng`,
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

let resourceCounter = 0;

async function makeApprovedResource(userId: string) {
  resourceCounter += 1;
  return prisma.studentResource.create({
    data: {
      userId,
      storageObjectId: randomUUID(),
      title: `Gate8 Resource #${resourceCounter}`,
      level: "100",
      department: "Computer Science",
      courseCode: "CSC101",
      courseTitle: "Intro to CS",
      resourceType: StudentResourceType.NOTE,
      fileFormat: FileFormat.PDF,
      status: StudentResourceStatus.APPROVED,
      approvedAt: new Date(),
    },
  });
}

async function ensureDailyGoal(userId: string, activityDate: Date) {
  return prisma.dailyGoal.upsert({
    where: { userId_activityDate: { userId, activityDate } },
    update: {},
    create: { userId, activityDate },
  });
}

/** Creates `count` active (non-revoked) contributions for userId on activityDate. */
async function addActiveContributions(userId: string, activityDate: Date, count: number) {
  const goal = await ensureDailyGoal(userId, activityDate);
  const created = [];
  for (let i = 0; i < count; i++) {
    const resource = await makeApprovedResource(userId);
    created.push(
      await prisma.resourceContribution.create({
        data: { studentResourceId: resource.id, dailyGoalId: goal.id },
      })
    );
  }
  return { goal, contributions: created };
}

async function recalc(userId: string) {
  return prisma.$transaction((tx) => ProgressionService.recalculateUserProgression(tx, userId));
}

async function runGate8Tests() {
  console.log("🧪 Starting Gate 8 Progression Calculation Test Suite...\n");

  const rankCount = await prisma.rankDefinition.count();
  if (rankCount !== 10) {
    console.log("Seeding rank definitions before test...");
    await seedRankDefinitions();
  }

  const testUserIds: string[] = [];

  try {
    // -------------------------------------------------------------------
    // Test 1: Daily goal percentage lookup (0/33/66/100) + completion flag
    // -------------------------------------------------------------------
    console.log("\n--- Test 1: Daily Goal Percentage & Completion ---");
    const u1 = await makeUser("gate8-daily", daysAgo(30));
    testUserIds.push(u1.id);
    const today = daysAgo(0);

    const emptySnapshot = await prisma.$transaction((tx) => ProgressionService.getDailyGoalForDate(tx, u1.id, today));
    assert(emptySnapshot.activeCount === 0 && emptySnapshot.percentage === 0, "0 active contributions -> 0%");
    assert(!emptySnapshot.completed, "0 active contributions -> not completed");

    await addActiveContributions(u1.id, today, 1);
    let snap = await prisma.$transaction((tx) => ProgressionService.getDailyGoalForDate(tx, u1.id, today));
    assert(snap.percentage === 33, "1 active contribution -> 33%");
    assert(!snap.completed, "1 active contribution -> not completed");

    await addActiveContributions(u1.id, today, 1);
    snap = await prisma.$transaction((tx) => ProgressionService.getDailyGoalForDate(tx, u1.id, today));
    assert(snap.percentage === 66, "2 active contributions -> 66% (not 67 — fixed lookup, not rounded division)");
    assert(!snap.completed, "2 active contributions -> not completed");

    await addActiveContributions(u1.id, today, 1);
    snap = await prisma.$transaction((tx) => ProgressionService.getDailyGoalForDate(tx, u1.id, today));
    assert(snap.percentage === 100, "3 active contributions -> 100%");
    assert(snap.completed, "3 active contributions -> completed");

    // A 4th same-day approval must not push the displayed percentage past 100.
    await addActiveContributions(u1.id, today, 1);
    snap = await prisma.$transaction((tx) => ProgressionService.getDailyGoalForDate(tx, u1.id, today));
    assert(snap.activeCount === 4 && snap.percentage === 100, "4 active contributions -> still capped at 100%");

    // -------------------------------------------------------------------
    // Test 2: Current vs. longest streak, including a broken/gapped history
    // -------------------------------------------------------------------
    console.log("\n--- Test 2: Streak Calculation ---");
    const u2 = await makeUser("gate8-streak", daysAgo(30));
    testUserIds.push(u2.id);

    // Complete today, today-1, today-2: a clean 3-day run ending today.
    await addActiveContributions(u2.id, daysAgo(0), 3);
    await addActiveContributions(u2.id, daysAgo(1), 3);
    await addActiveContributions(u2.id, daysAgo(2), 3);
    let progression = await recalc(u2.id);
    assert(progression.currentStreak === 3, "3 consecutive completed days ending today -> currentStreak 3");
    assert(progression.longestStreak === 3, "longestStreak matches the only run so far (3)");

    // Isolated completed day at today-4 (today-3 stays incomplete): must not
    // extend or otherwise disturb the current streak, and must not beat the
    // existing longest streak (run length 1 < 3).
    await addActiveContributions(u2.id, daysAgo(4), 3);
    progression = await recalc(u2.id);
    assert(progression.currentStreak === 3, "Isolated older completed day does not affect currentStreak");
    assert(progression.longestStreak === 3, "Isolated older completed day (run of 1) does not beat longestStreak of 3");

    // -------------------------------------------------------------------
    // Test 3: A streak whose latest completed day is yesterday still counts;
    // one whose latest completed day is 2+ days old is broken (0).
    // -------------------------------------------------------------------
    console.log("\n--- Test 3: Streak Recency Rule (today/yesterday vs. older) ---");
    const u3 = await makeUser("gate8-streak-recency", daysAgo(30));
    testUserIds.push(u3.id);

    await addActiveContributions(u3.id, daysAgo(1), 3);
    await addActiveContributions(u3.id, daysAgo(2), 3);
    progression = await recalc(u3.id);
    assert(progression.currentStreak === 2, "Latest completed day = yesterday -> currentStreak still counts (2)");

    const u3b = await makeUser("gate8-streak-broken", daysAgo(30));
    testUserIds.push(u3b.id);
    await addActiveContributions(u3b.id, daysAgo(2), 3);
    await addActiveContributions(u3b.id, daysAgo(3), 3);
    progression = await recalc(u3b.id);
    assert(progression.currentStreak === 0, "Latest completed day = 2+ days ago -> currentStreak broken (0)");
    assert(progression.longestStreak === 2, "longestStreak still reflects the historical run (2)");

    // Skip-then-resume: an older 2-day run (days -4, -3), a gap (days -2, -1
    // left incomplete), then a single fresh completion today. currentStreak
    // must reset to a NEW streak of 1 rather than resuming the old run, while
    // longestStreak still remembers the earlier 2-day run.
    const u3c = await makeUser("gate8-streak-resume", daysAgo(30));
    testUserIds.push(u3c.id);
    await addActiveContributions(u3c.id, daysAgo(4), 3);
    await addActiveContributions(u3c.id, daysAgo(3), 3);
    await addActiveContributions(u3c.id, daysAgo(0), 3);
    progression = await recalc(u3c.id);
    assert(progression.currentStreak === 1, "A skipped gap resets currentStreak; today's fresh completion starts a new streak of 1");
    assert(progression.longestStreak === 2, "longestStreak still reflects the earlier 2-day run despite the reset");

    // -------------------------------------------------------------------
    // Test 4: Rolling 7-day consistency, rounded, with proper Lagos rounding
    // -------------------------------------------------------------------
    console.log("\n--- Test 4: Rolling Consistency (window, rounding) ---");
    // Account created exactly 2 Lagos-days before today -> 3 eligible days
    // (today-2, today-1, today), even though the rolling window is 7 days.
    const u4 = await makeUser("gate8-consistency", daysAgo(2));
    testUserIds.push(u4.id);
    await addActiveContributions(u4.id, daysAgo(0), 3); // completed
    await addActiveContributions(u4.id, daysAgo(2), 3); // completed
    // daysAgo(1) intentionally left incomplete.

    const consistency = await prisma.$transaction((tx) =>
      ProgressionService.getRollingConsistency(tx, u4.id, daysAgo(0))
    );
    assert(consistency.eligibleDays === 3, "Denominator excludes days before account creation (3, not 7)");
    assert(consistency.completedDays === 2, "2 of the 3 eligible days were completed");
    assert(consistency.percentage === 67, "2/3 rounds to 67% (rounded division, distinct from the 66% goal lookup)");

    // -------------------------------------------------------------------
    // Test 5: Account created "today" -> eligibleDays is 1, not 7
    // -------------------------------------------------------------------
    console.log("\n--- Test 5: Consistency Window Cannot Predate Account Creation ---");
    const u5 = await makeUser("gate8-newaccount", new Date());
    testUserIds.push(u5.id);
    await addActiveContributions(u5.id, daysAgo(0), 3);

    const freshConsistency = await prisma.$transaction((tx) =>
      ProgressionService.getRollingConsistency(tx, u5.id, daysAgo(0))
    );
    assert(freshConsistency.eligibleDays === 1, "Brand-new account -> eligibleDays capped at 1, not the full 7-day window");
    assert(freshConsistency.percentage === 100, "Sole eligible day completed -> 100%");

    // -------------------------------------------------------------------
    // Test 6: Rank boundaries — exact thresholds (0, 10, 20, 90), plus 91
    // (just past the 90 Ultimate threshold) confirming no overflow past the
    // ladder's terminal rank.
    // -------------------------------------------------------------------
    console.log("\n--- Test 6: Rank Boundary Assignment ---");

    const uRank0 = await makeUser("gate8-rank-0", daysAgo(30));
    testUserIds.push(uRank0.id);
    progression = await prisma.userProgression.findUniqueOrThrow({
      where: { userId: (await recalc(uRank0.id)).userId },
      include: { rank: true },
    });
    assert(progression.approvedResourceCount === 0 && progression.rank.name === "Novice", "0 approved -> Novice (min 0)");

    const uRank10 = await makeUser("gate8-rank-10", daysAgo(30));
    testUserIds.push(uRank10.id);
    await addActiveContributions(uRank10.id, daysAgo(10), 10);
    progression = await prisma.userProgression.findUniqueOrThrow({
      where: { userId: (await recalc(uRank10.id)).userId },
      include: { rank: true },
    });
    assert(progression.approvedResourceCount === 10 && progression.rank.name === "Amateur", "10 approved -> Amateur (min 10 boundary)");

    const uRank20 = await makeUser("gate8-rank-20", daysAgo(30));
    testUserIds.push(uRank20.id);
    await addActiveContributions(uRank20.id, daysAgo(10), 20);
    progression = await prisma.userProgression.findUniqueOrThrow({
      where: { userId: (await recalc(uRank20.id)).userId },
      include: { rank: true },
    });
    assert(progression.approvedResourceCount === 20 && progression.rank.name === "Senior", "20 approved -> Senior (min 20 boundary)");

    const uRank90 = await makeUser("gate8-rank-90", daysAgo(30));
    testUserIds.push(uRank90.id);
    await addActiveContributions(uRank90.id, daysAgo(10), 90);
    progression = await prisma.userProgression.findUniqueOrThrow({
      where: { userId: (await recalc(uRank90.id)).userId },
      include: { rank: true },
    });
    assert(progression.approvedResourceCount === 90 && progression.rank.name === "Ultimate", "90 approved -> Ultimate (min 90 boundary)");

    const uRank91 = await makeUser("gate8-rank-91", daysAgo(30));
    testUserIds.push(uRank91.id);
    await addActiveContributions(uRank91.id, daysAgo(10), 91);
    progression = await prisma.userProgression.findUniqueOrThrow({
      where: { userId: (await recalc(uRank91.id)).userId },
      include: { rank: true },
    });
    assert(progression.approvedResourceCount === 91 && progression.rank.name === "Ultimate", "91 approved -> still Ultimate, no overflow past the ladder");

    // -------------------------------------------------------------------
    // Test 7: Revoked contributions are excluded everywhere they matter
    // -------------------------------------------------------------------
    console.log("\n--- Test 7: Revocation Exclusion ---");
    const u8 = await makeUser("gate8-revocation", daysAgo(30));
    testUserIds.push(u8.id);
    const { contributions } = await addActiveContributions(u8.id, daysAgo(0), 3);
    progression = await recalc(u8.id);
    assert(progression.approvedResourceCount === 3, "3 active contributions counted before revocation");
    assert(progression.currentStreak === 1, "Single completed day -> currentStreak 1 before revocation");

    await prisma.resourceContribution.update({
      where: { id: contributions[0].id },
      data: { revokedAt: new Date(), revocationReason: "Gate 8 test revocation" },
    });
    progression = await recalc(u8.id);
    assert(progression.approvedResourceCount === 2, "Revoked contribution excluded from approvedResourceCount (3 -> 2)");
    assert(progression.currentStreak === 0, "Day drops below 3 active contributions -> no longer completed -> streak resets to 0");

    const snapAfterRevoke = await prisma.$transaction((tx) => ProgressionService.getDailyGoalForDate(tx, u8.id, daysAgo(0)));
    assert(snapAfterRevoke.activeCount === 2 && snapAfterRevoke.percentage === 66, "Daily goal snapshot excludes the revoked contribution");

    // -------------------------------------------------------------------
    // Test 8: Lagos midnight boundary — an approval timestamp 1ms before
    // Lagos midnight and one exactly at Lagos midnight must resolve to
    // different DailyGoal.activityDate values (the same getLagosCalendarDate
    // logic StudentResourceService.reviewResource uses on approval).
    // -------------------------------------------------------------------
    console.log("\n--- Test 8: Lagos Midnight Boundary -> DailyGoal.activityDate ---");
    const u9 = await makeUser("gate8-midnight", daysAgo(30));
    testUserIds.push(u9.id);

    // 2026-09-02T22:59:59.999Z = 2026-09-02 23:59:59.999+01:00 (Lagos) -> Sept 2 Lagos day
    const justBeforeLagosMidnight = new Date("2026-09-02T22:59:59.999Z");
    // 2026-09-02T23:00:00.000Z = 2026-09-03 00:00:00.000+01:00 (Lagos) -> Sept 3 Lagos day
    const exactLagosMidnight = new Date("2026-09-02T23:00:00.000Z");

    const dateBefore = getLagosCalendarDate(justBeforeLagosMidnight);
    const dateAfter = getLagosCalendarDate(exactLagosMidnight);
    assert(dateBefore.getTime() !== dateAfter.getTime(), "1ms apart, straddling Lagos midnight -> different calendar dates");
    assert(dateAfter.getTime() - dateBefore.getTime() === ONE_DAY_MS, "The two dates are exactly one Lagos calendar day apart");

    const goalBefore = await ensureDailyGoal(u9.id, dateBefore);
    const goalAfter = await ensureDailyGoal(u9.id, dateAfter);
    assert(goalBefore.id !== goalAfter.id, "Straddling approvals upsert into two distinct DailyGoal rows, not one");

    const resourceBefore = await makeApprovedResource(u9.id);
    await prisma.resourceContribution.create({
      data: { studentResourceId: resourceBefore.id, dailyGoalId: goalBefore.id, countedAt: justBeforeLagosMidnight },
    });
    const resourceAfter = await makeApprovedResource(u9.id);
    await prisma.resourceContribution.create({
      data: { studentResourceId: resourceAfter.id, dailyGoalId: goalAfter.id, countedAt: exactLagosMidnight },
    });

    const snapBeforeDay = await prisma.$transaction((tx) => ProgressionService.getDailyGoalForDate(tx, u9.id, dateBefore));
    const snapAfterDay = await prisma.$transaction((tx) => ProgressionService.getDailyGoalForDate(tx, u9.id, dateAfter));
    assert(snapBeforeDay.activeCount === 1, "Pre-midnight approval counted on the earlier Lagos day only");
    assert(snapAfterDay.activeCount === 1, "Post-midnight approval counted on the later Lagos day only");

    // -------------------------------------------------------------------
    // Test 9: Reconciliation restores a deliberately corrupted
    // UserProgression snapshot back to what the active ResourceContribution
    // ledger implies.
    // -------------------------------------------------------------------
    console.log("\n--- Test 9: Reconciliation Restores Corrupted Snapshot ---");
    const u10 = await makeUser("gate8-corrupt", daysAgo(30));
    testUserIds.push(u10.id);
    await addActiveContributions(u10.id, daysAgo(0), 3);
    const correct = await recalc(u10.id);

    // Deliberately corrupt the stored snapshot directly, bypassing the service.
    await prisma.userProgression.update({
      where: { userId: u10.id },
      data: { approvedResourceCount: 999, currentStreak: 999, longestStreak: 999 },
    });
    const corrupted = await prisma.userProgression.findUniqueOrThrow({ where: { userId: u10.id } });
    assert(corrupted.approvedResourceCount === 999, "Snapshot was deliberately corrupted before reconciliation");

    const reconciled = await recalc(u10.id);
    assert(
      reconciled.approvedResourceCount === correct.approvedResourceCount &&
        reconciled.currentStreak === correct.currentStreak &&
        reconciled.longestStreak === correct.longestStreak,
      "Reconciliation rebuilds the corrupted snapshot back to the values derived from active contributions"
    );

    console.log("\n🎉 All Gate 8 Progression Calculation Scenarios Verified Successfully!\n");
  } finally {
    await prisma.resourceContribution.deleteMany({ where: { studentResource: { userId: { in: testUserIds } } } });
    await prisma.studentResource.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.dailyGoal.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.userProgression.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await prisma.$disconnect();
  }
}

runGate8Tests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Gate 8 Test execution failed:", err);
    process.exit(1);
  });
