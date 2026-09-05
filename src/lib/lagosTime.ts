// lib/lagosTime.ts
//
// Shared Africa/Lagos calendar-day helpers. Extracted out of
// studentResourceService.ts (Gate 6) so both StudentResourceService and
// ProgressionService (Gate 8) can depend on the same date logic without
// importing from each other — StudentResourceService calls into
// ProgressionService, so ProgressionService cannot import date helpers back
// from StudentResourceService without a circular dependency.
//
// Africa/Lagos is UTC+1 (WAT) with no daylight saving time, which is what
// makes "next Lagos calendar day" a fixed 24h offset in epoch time (see
// isNextLagosCalendarDay) — that would not hold in a DST timezone.

/**
 * Extracts the Y/M/D components of `date` as evaluated in the Africa/Lagos
 * timezone. Shared by getLagosDayBounds (day-boundary timestamps) and
 * getLagosCalendarDate (pure calendar date, for @db.Date columns) so both
 * always agree on which Lagos calendar day a given instant belongs to.
 */
function lagosDateParts(date: Date): { year: string; month: string; day: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  return {
    year: parts.find((p) => p.type === "year")!.value,
    month: parts.find((p) => p.type === "month")!.value,
    day: parts.find((p) => p.type === "day")!.value,
  };
}

/**
 * Calculates start (00:00:00.000) and end (23:59:59.999) timestamps for the
 * current Africa/Lagos calendar day.
 */
export function getLagosDayBounds(date: Date = new Date()): { start: Date; end: Date } {
  const { year, month, day } = lagosDateParts(date);
  const start = new Date(`${year}-${month}-${day}T00:00:00.000+01:00`);
  const end = new Date(`${year}-${month}-${day}T23:59:59.999+01:00`);
  return { start, end };
}

/**
 * Returns the Africa/Lagos calendar date that `date` falls on, as a
 * UTC-midnight Date suitable for Prisma @db.Date columns (DailyGoal.activityDate).
 * A resource approved at 23:30 WAT and one approved at 00:05 WAT the next day
 * must resolve to different calendar dates here, independent of server TZ.
 */
export function getLagosCalendarDate(date: Date = new Date()): Date {
  const { year, month, day } = lagosDateParts(date);
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

// Daily goal target from daily-goal-architecture.md §3: 3 approved resources
// per Lagos calendar day completes that day's goal.
export const DAILY_GOAL_TARGET = 3;

// activityDate values come back from Prisma as UTC-midnight Date objects for
// a @db.Date column, so "the next Lagos calendar day" is always exactly
// 24h later in epoch time — no DST in Africa/Lagos to complicate this.
export function isNextLagosCalendarDay(earlier: Date, later: Date): boolean {
  return later.getTime() - earlier.getTime() === 24 * 60 * 60 * 1000;
}
