-- Tracks when a student's department was last changed post-onboarding, so
-- PATCH /api/user/department can enforce a 60-day cooldown server-side
-- (see updateDepartment in onboardingService.ts). Nullable: null means the
-- department has never been changed since the original onboarding record
-- was created, so no cooldown applies yet.
--
-- Additive only — no DROP, no data loss, safe to run against a live table.

ALTER TABLE "Onboarding" ADD COLUMN "departmentChangedAt" TIMESTAMP(3);
