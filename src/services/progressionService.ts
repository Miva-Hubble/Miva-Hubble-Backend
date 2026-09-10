// services/progressionService.ts
//
// Centralized progression calculation (Gate 8) — moved out of
// StudentResourceService so admin moderation, reconciliation tooling, and
// any future progression-read endpoints all share one source of truth.
//
// Everything here is derived exclusively from ResourceContribution rows
// where revokedAt IS NULL. UserProgression is a cache of these
// calculations, never the input to them — see prisma/schema.prisma's
// comment above the UserProgression model. Nothing here mutates a stored
// counter directly; recalculateUserProgression always recomputes from
// scratch and upserts the result, which is what makes it safe to call
// after an approval, a rejection, or a revocation alike.

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma.js";
import { DAILY_GOAL_TARGET, getLagosCalendarDate, isNextLagosCalendarDay } from "../lib/lagosTime.js";

// 0/1/2/3+ active contributions -> 0/33/66/100 display percentage. A lookup
// table, not a division formula — 2/3 rounds to 67 with Math.round, but
// daily-goal-architecture.md §3 specifies 66 exactly, so the mapping is
// fixed rather than computed.
const DAILY_GOAL_PERCENTAGE_BY_COUNT = [0, 33, 66, 100] as const;

// Fixed size of the rolling consistency window (see getRollingConsistency).
// Exported so callers — e.g. the Gate 9 student progress endpoint — can
// report the window size in their response without hardcoding the same
// magic number a second time.
export const ROLLING_CONSISTENCY_WINDOW_DAYS = 7;

export interface DailyGoalSnapshot {
  activityDate: Date;
  activeCount: number;
  percentage: 0 | 33 | 66 | 100;
  completed: boolean;
}

export interface RollingConsistency {
  windowStart: Date;
  windowEnd: Date;
  eligibleDays: number;
  completedDays: number;
  percentage: number;
}

export interface NextRankProgress {
  name: string;
  minimumApprovedResources: number;
  resourcesRemaining: number;
}

export interface StudentProgressSnapshot {
  dailyGoal: {
    activeCount: number;
    target: number;
    percentage: 0 | 33 | 66 | 100;
    completed: boolean;
  };
  streak: {
    current: number;
    longest: number;
  };
  consistency: {
    windowDays: number;
    eligibleDays: number;
    completedDays: number;
    percentage: number;
  };
  rank: {
    name: string;
    level: number;
    approvedResourceCount: number;
    nextRank: NextRankProgress | null;
  };
}

export interface AdminUserProgressSnapshot extends StudentProgressSnapshot {
  user: {
    id: string;
    name: string;
    username: string | null;
    email: string;
  };
  recentDays: {
    date: string;
    activeCount: number;
    percentage: 0 | 33 | 66 | 100;
    completed: boolean;
  }[];
}

export interface AdminProgressionListItem {
  id: string;
  name: string;
  username: string | null;
  email: string;
  rank: { name: string; level: number };
  approvedResourceCount: number;
  streak: { current: number; longest: number };
  consistency: {
    windowDays: number;
    eligibleDays: number;
    completedDays: number;
    percentage: number;
  };
}

export interface AdminProgressionListResult {
  users: AdminProgressionListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export class ProgressionService {
  /**
   * Recomputes and upserts a user's UserProgression entirely from their
   * currently active (non-revoked) ResourceContribution rows. Never
   * incremented — always derived from scratch, so it stays reconcilable
   * even after a revocation changes which days/contributions are active.
   *
   * Must be called inside the same transaction as whatever state change
   * (approval, rejection with no-op, archive/revocation) triggered it, so
   * the recalculation sees a consistent view of the ledger.
   */
  static async recalculateUserProgression(tx: Prisma.TransactionClient, userId: string) {
    const activeContributions = await tx.resourceContribution.findMany({
      where: {
        revokedAt: null,
        studentResource: { userId },
      },
      select: { dailyGoalId: true },
    });

    const approvedResourceCount = activeContributions.length;

    const countsByGoal = new Map<string, number>();
    for (const c of activeContributions) {
      countsByGoal.set(c.dailyGoalId, (countsByGoal.get(c.dailyGoalId) ?? 0) + 1);
    }
    const completedGoalIds = [...countsByGoal.entries()]
      .filter(([, count]) => count >= DAILY_GOAL_TARGET)
      .map(([id]) => id);

    let currentStreak = 0;
    let longestStreak = 0;
    let lastCompletedGoalDate: Date | null = null;

    if (completedGoalIds.length > 0) {
      const completedGoals = await tx.dailyGoal.findMany({
        where: { id: { in: completedGoalIds } },
        select: { activityDate: true },
        orderBy: { activityDate: "asc" },
      });

      const dates = completedGoals.map((g) => g.activityDate);
      lastCompletedGoalDate = dates[dates.length - 1];

      // Longest historical run of consecutive completed Lagos days.
      let runLength = 1;
      longestStreak = 1;
      for (let i = 1; i < dates.length; i++) {
        runLength = isNextLagosCalendarDay(dates[i - 1], dates[i]) ? runLength + 1 : 1;
        if (runLength > longestStreak) longestStreak = runLength;
      }

      // Trailing run ending at the most recent completed day.
      let trailing = 1;
      for (let i = dates.length - 1; i > 0; i--) {
        if (isNextLagosCalendarDay(dates[i - 1], dates[i])) trailing += 1;
        else break;
      }

      // The trailing run only counts as the CURRENT streak if the most
      // recent completed day is today or yesterday — otherwise the streak
      // is broken and current is 0, even though longestStreak still
      // remembers it happened.
      const today = getLagosCalendarDate(new Date());
      const oneDayMs = 24 * 60 * 60 * 1000;
      const diffFromToday = today.getTime() - lastCompletedGoalDate.getTime();
      currentStreak = diffFromToday === 0 || diffFromToday === oneDayMs ? trailing : 0;
    }

    const rank = await tx.rankDefinition.findFirst({
      where: { minimumApprovedResources: { lte: approvedResourceCount } },
      orderBy: { minimumApprovedResources: "desc" },
    });

    if (!rank) {
      throw new Error(
        "No rank definition matches this approved count — seed rank_definitions first (pnpm seed:ranks)"
      );
    }

    return tx.userProgression.upsert({
      where: { userId },
      update: {
        rankId: rank.id,
        approvedResourceCount,
        currentStreak,
        longestStreak,
        lastCompletedGoalDate,
      },
      create: {
        userId,
        rankId: rank.id,
        approvedResourceCount,
        currentStreak,
        longestStreak,
        lastCompletedGoalDate,
      },
    });
  }

  /**
   * Derived daily-goal snapshot for one user on one Lagos calendar day: how
   * many active contributions landed on that day, the 0/33/66/100 display
   * percentage, and whether the goal is complete (3+ active contributions).
   *
   * `activityDate` must already be a Lagos-calendar-normalized UTC-midnight
   * Date (see getLagosCalendarDate) — this function does no timezone work
   * itself, it only counts what's attached to the matching DailyGoal row.
   */
  static async getDailyGoalForDate(
    tx: Prisma.TransactionClient,
    userId: string,
    activityDate: Date
  ): Promise<DailyGoalSnapshot> {
    const dailyGoal = await tx.dailyGoal.findUnique({
      where: { userId_activityDate: { userId, activityDate } },
      select: {
        contributions: {
          where: { revokedAt: null },
          select: { id: true },
        },
      },
    });

    const activeCount = dailyGoal?.contributions.length ?? 0;
    const cappedCount = Math.min(activeCount, DAILY_GOAL_TARGET) as 0 | 1 | 2 | 3;

    return {
      activityDate,
      activeCount,
      percentage: DAILY_GOAL_PERCENTAGE_BY_COUNT[cappedCount],
      completed: activeCount >= DAILY_GOAL_TARGET,
    };
  }

  /**
   * Rolling 7-Lagos-calendar-day consistency ending at (and including)
   * `asOfDate`. The denominator (`eligibleDays`) never counts days before
   * the user's account was created — a 2-day-old account can only ever be
   * judged against the 2 days it has actually existed for, not a full
   * 7-day window it wasn't around for. Percentage is rounded to a whole
   * number; a user with zero eligible days (e.g. account created in the
   * future, which should never happen) gets 0 rather than a division by
   * zero.
   */
  static async getRollingConsistency(
    tx: Prisma.TransactionClient,
    userId: string,
    asOfDate: Date = getLagosCalendarDate(new Date())
  ): Promise<RollingConsistency> {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const normalizedAsOf = getLagosCalendarDate(asOfDate);
    const sevenDayWindowStart = new Date(normalizedAsOf.getTime() - (ROLLING_CONSISTENCY_WINDOW_DAYS - 1) * oneDayMs);

    const user = await tx.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    if (!user) {
      throw new Error("User not found");
    }

    const accountCreatedDate = getLagosCalendarDate(user.createdAt);
    const windowStart =
      accountCreatedDate.getTime() > sevenDayWindowStart.getTime() ? accountCreatedDate : sevenDayWindowStart;

    const eligibleDays = Math.max(
      0,
      Math.floor((normalizedAsOf.getTime() - windowStart.getTime()) / oneDayMs) + 1
    );

    const dailyGoals = await tx.dailyGoal.findMany({
      where: {
        userId,
        activityDate: { gte: windowStart, lte: normalizedAsOf },
      },
      select: {
        contributions: {
          where: { revokedAt: null },
          select: { id: true },
        },
      },
    });

    const completedDays = dailyGoals.filter((g) => g.contributions.length >= DAILY_GOAL_TARGET).length;
    const percentage = eligibleDays > 0 ? Math.round((completedDays / eligibleDays) * 100) : 0;

    return {
      windowStart,
      windowEnd: normalizedAsOf,
      eligibleDays,
      completedDays,
      percentage,
    };
  }

  /**
   * Read-only progress snapshot for one student's own dashboard (Gate 9).
   * Deliberately never writes: it does not call recalculateUserProgression,
   * so a student loading their dashboard can never have the side effect of
   * materializing a UserProgression row. If none exists yet (the student
   * has never had a resource approved), the response is the Novice-
   * equivalent zero state instead — computed here, not persisted.
   *
   * Reuses getDailyGoalForDate and getRollingConsistency rather than
   * recomputing daily/consistency figures a second way, and reads
   * currentStreak/longestStreak/approvedResourceCount straight off the
   * stored UserProgression snapshot (falling back to zero) rather than
   * re-deriving them — that derivation is recalculateUserProgression's job
   * alone, kept in one place so approval/archive and this read path can
   * never quietly disagree.
   */
  static async getStudentProgress(userId: string): Promise<StudentProgressSnapshot> {
    const today = getLagosCalendarDate(new Date());

    const [storedProgression, dailyGoal, consistency, rankDefinitions] = await Promise.all([
      prisma.userProgression.findUnique({ where: { userId }, include: { rank: true } }),
      this.getDailyGoalForDate(prisma, userId, today),
      this.getRollingConsistency(prisma, userId, today),
      prisma.rankDefinition.findMany({ orderBy: { level: "asc" } }),
    ]);

    if (rankDefinitions.length === 0) {
      throw new Error("Rank definitions are not seeded");
    }

    const approvedResourceCount = storedProgression?.approvedResourceCount ?? 0;
    // rankDefinitions[0] is level 1 (Novice, minimumApprovedResources 0) —
    // the correct default when no UserProgression row exists yet.
    const currentRank = storedProgression?.rank ?? rankDefinitions[0];
    const currentRankIndex = rankDefinitions.findIndex((r) => r.id === currentRank.id);
    const nextRankDefinition = currentRankIndex >= 0 ? rankDefinitions[currentRankIndex + 1] : undefined;

    const nextRank: NextRankProgress | null = nextRankDefinition
      ? {
          name: nextRankDefinition.name,
          minimumApprovedResources: nextRankDefinition.minimumApprovedResources,
          resourcesRemaining: Math.max(0, nextRankDefinition.minimumApprovedResources - approvedResourceCount),
        }
      : null; // Ultimate (the last rank in the ladder) has no next rank.

    return {
      dailyGoal: {
        activeCount: dailyGoal.activeCount,
        target: DAILY_GOAL_TARGET,
        percentage: dailyGoal.percentage,
        completed: dailyGoal.completed,
      },
      streak: {
        current: storedProgression?.currentStreak ?? 0,
        longest: storedProgression?.longestStreak ?? 0,
      },
      consistency: {
        windowDays: ROLLING_CONSISTENCY_WINDOW_DAYS,
        eligibleDays: consistency.eligibleDays,
        completedDays: consistency.completedDays,
        percentage: consistency.percentage,
      },
      rank: {
        name: currentRank.name,
        level: currentRank.level,
        approvedResourceCount,
        nextRank,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Admin progression reporting (Gate 10)
  // ---------------------------------------------------------------------

  /**
   * Last `days` Lagos-calendar-day daily-goal snapshots ending at (and
   * including) `asOfDate`, oldest first. Unlike getDailyGoalForDate (one
   * day at a time), this fetches every DailyGoal row in the window in a
   * single query and fills in zero-activity days that never got a
   * DailyGoal row at all — a day with 0 active contributions is still a
   * reportable record, not a gap in the array.
   */
  static async getRecentDailyRecords(
    userId: string,
    days: number = ROLLING_CONSISTENCY_WINDOW_DAYS,
    asOfDate: Date = getLagosCalendarDate(new Date())
  ): Promise<DailyGoalSnapshot[]> {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const normalizedAsOf = getLagosCalendarDate(asOfDate);
    const windowStart = new Date(normalizedAsOf.getTime() - (days - 1) * oneDayMs);

    const dailyGoals = await prisma.dailyGoal.findMany({
      where: { userId, activityDate: { gte: windowStart, lte: normalizedAsOf } },
      select: {
        activityDate: true,
        contributions: { where: { revokedAt: null }, select: { id: true } },
      },
    });

    const activeCountByDate = new Map<number, number>();
    for (const goal of dailyGoals) {
      activeCountByDate.set(goal.activityDate.getTime(), goal.contributions.length);
    }

    const records: DailyGoalSnapshot[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const activityDate = new Date(normalizedAsOf.getTime() - i * oneDayMs);
      const activeCount = activeCountByDate.get(activityDate.getTime()) ?? 0;
      const cappedCount = Math.min(activeCount, DAILY_GOAL_TARGET) as 0 | 1 | 2 | 3;
      records.push({
        activityDate,
        activeCount,
        percentage: DAILY_GOAL_PERCENTAGE_BY_COUNT[cappedCount],
        completed: activeCount >= DAILY_GOAL_TARGET,
      });
    }
    return records;
  }

  /**
   * Admin-facing detail report for one user: the same rank/streak/daily-goal
   * structure getStudentProgress returns for the student's own dashboard,
   * plus the user's identity and their last 7 Lagos-calendar-day records.
   * Read-only, same as getStudentProgress — never materializes a
   * UserProgression row for a user who has never had a resource approved.
   * Throws "User not found" (mapped to 404 by the controller) if userId
   * does not resolve to an existing user.
   */
  static async getAdminUserProgress(userId: string): Promise<AdminUserProgressSnapshot> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, username: true, email: true },
    });
    if (!user) {
      throw new Error("User not found");
    }

    const [progress, recentRecords] = await Promise.all([
      this.getStudentProgress(userId),
      this.getRecentDailyRecords(userId),
    ]);

    return {
      user,
      ...progress,
      recentDays: recentRecords.map((record) => ({
        date: record.activityDate.toISOString().slice(0, 10),
        activeCount: record.activeCount,
        percentage: record.percentage,
        completed: record.completed,
      })),
    };
  }

  /**
   * Paginated admin roster of every user's progression, with optional rank
   * filtering and name/username/email search. Deliberately a single
   * `$queryRaw` query plan (CTEs + a window-function total count) rather
   * than per-user Prisma calls in a loop — computing each user's rolling
   * 7-day consistency the same way getRollingConsistency does, for however
   * many users `limit` allows, would otherwise be an N+1 query per page.
   * Users with no UserProgression row yet fall back to the Novice rank
   * (level 1) and zeroed counters, matching getStudentProgress's default.
   * Never selects storage paths, signed URLs, passwords, or tokens — only
   * identity + progression fields leave this query.
   */
  static async listUserProgression(params: {
    page: number;
    limit: number;
    rankLevel?: number;
    search?: string;
  }): Promise<AdminProgressionListResult> {
    const { page, limit, rankLevel, search } = params;
    const oneDayMs = 24 * 60 * 60 * 1000;
    const today = getLagosCalendarDate(new Date());
    const windowStart = new Date(today.getTime() - (ROLLING_CONSISTENCY_WINDOW_DAYS - 1) * oneDayMs);
    const offset = (page - 1) * limit;

    const conditions: Prisma.Sql[] = [];
    if (rankLevel !== undefined) {
      conditions.push(Prisma.sql`COALESCE(rd.level, novice.level) = ${rankLevel}`);
    }
    if (search) {
      // Escape ILIKE wildcard metacharacters in user-supplied search text so
      // a literal "%" or "_" in a name/email can't widen the match.
      const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;
      conditions.push(
        Prisma.sql`(u.name ILIKE ${pattern} ESCAPE '\\' OR u.username ILIKE ${pattern} ESCAPE '\\' OR u.email ILIKE ${pattern} ESCAPE '\\')`
      );
    }
    const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

    type Row = {
      id: string;
      name: string;
      username: string | null;
      email: string;
      created_at: Date;
      rank_level: number;
      rank_name: string;
      approved_resource_count: number;
      current_streak: number;
      longest_streak: number;
      completed_days: number;
      total_count: number;
    };

    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH bounds AS (
        SELECT ${windowStart}::date AS window_start, ${today}::date AS window_end
      ),
      contribution_counts AS (
        SELECT dg.user_id, dg.activity_date, COUNT(rc.id)::int AS active_count
        FROM daily_goals dg
        JOIN resource_contributions rc ON rc.daily_goal_id = dg.id AND rc.revoked_at IS NULL
        CROSS JOIN bounds b
        WHERE dg.activity_date BETWEEN b.window_start AND b.window_end
        GROUP BY dg.user_id, dg.activity_date
      ),
      completed_days AS (
        SELECT user_id, COUNT(*)::int AS completed_days
        FROM contribution_counts
        WHERE active_count >= 3
        GROUP BY user_id
      ),
      novice AS (
        SELECT id, name, level FROM rank_definitions WHERE level = 1 LIMIT 1
      ),
      filtered AS (
        SELECT
          u.id,
          u.name,
          u.username,
          u.email,
          u."createdAt" AS created_at,
          COALESCE(rd.level, novice.level) AS rank_level,
          COALESCE(rd.name, novice.name) AS rank_name,
          COALESCE(up.approved_resource_count, 0) AS approved_resource_count,
          COALESCE(up.current_streak, 0) AS current_streak,
          COALESCE(up.longest_streak, 0) AS longest_streak,
          COALESCE(cd.completed_days, 0) AS completed_days
        FROM "User" u
        CROSS JOIN novice
        LEFT JOIN user_progressions up ON up.user_id = u.id
        LEFT JOIN rank_definitions rd ON rd.id = up.rank_id
        LEFT JOIN completed_days cd ON cd.user_id = u.id
        ${whereClause}
      )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM filtered
      ORDER BY rank_level DESC, approved_resource_count DESC, name ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const total = rows[0]?.total_count ?? 0;

    const users: AdminProgressionListItem[] = rows.map((row) => {
      const accountCreatedDate = getLagosCalendarDate(row.created_at);
      const effectiveWindowStart =
        accountCreatedDate.getTime() > windowStart.getTime() ? accountCreatedDate : windowStart;
      const eligibleDays = Math.max(0, Math.floor((today.getTime() - effectiveWindowStart.getTime()) / oneDayMs) + 1);
      // contribution_counts is only ever populated from real ResourceContribution
      // rows, which can't predate account creation, so completedDays should
      // never exceed eligibleDays — clamped defensively rather than trusted.
      const completedDays = Math.min(row.completed_days, eligibleDays);
      const percentage = eligibleDays > 0 ? Math.round((completedDays / eligibleDays) * 100) : 0;

      return {
        id: row.id,
        name: row.name,
        username: row.username,
        email: row.email,
        rank: { name: row.rank_name, level: row.rank_level },
        approvedResourceCount: row.approved_resource_count,
        streak: { current: row.current_streak, longest: row.longest_streak },
        consistency: {
          windowDays: ROLLING_CONSISTENCY_WINDOW_DAYS,
          eligibleDays,
          completedDays,
          percentage,
        },
      };
    });

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }
}
