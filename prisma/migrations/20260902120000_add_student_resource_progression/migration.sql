-- Gate 2 — MANUAL DRAFT. DO NOT EXECUTE until reviewed and applied via the
-- normal migration flow. This file is hand-written to precede the models
-- already declared in prisma/schema.prisma (StudentResource, DailyGoal,
-- ResourceContribution, RankDefinition, UserProgression) — see the schema
-- comments there for full field-level rationale.
--
-- Scope of this migration (nothing else):
--   * CREATE TYPE "StudentResourceStatus", "StudentResourceType"
--   * CREATE TABLE for the five new tables listed above
--   * All schema-approved indexes/unique constraints on those tables
--   * FKs from the new tables into "User", "Admin", and "rank_definitions"
--   * No seeding of rank_definitions rows
--   * No FK to Supabase-managed storage.objects
--   * No ALTER of any pre-existing table/column — "User"/"Admin" are only
--     ever referenced, never modified, by the FKs below.
--
-- FK delete-behavior summary (must match prisma/schema.prisma exactly):
--   student_resources.user_id                -> "User"(id)              RESTRICT
--     (accounting history: a StudentResource with a ResourceContribution
--     must never be cascade-deletable through its owning user)
--   student_resources.reviewed_by_admin_id   -> "Admin"(id)              SET NULL
--     (reviewer-admin deletion must never be blocked by past reviews)
--   daily_goals.user_id                      -> "User"(id)              RESTRICT
--     (same accounting-history reasoning as student_resources.user_id)
--   resource_contributions.student_resource_id -> student_resources(id) RESTRICT
--     (the ledger row must never disappear out from under its resource)
--   resource_contributions.daily_goal_id     -> daily_goals(id)          RESTRICT
--     (the ledger row must never disappear out from under its goal)
--   user_progressions.user_id                -> "User"(id)              CASCADE
--     (denormalized snapshot, not ledger — safe to cascade with its user)
--   user_progressions.rank_id                -> rank_definitions(id)     RESTRICT
--     (a rank definition must never be deletable while referenced)
--
-- student_resources.storage_object_id intentionally has NO foreign key into
-- Supabase's managed "storage" schema, for the same reason user_files and
-- books don't (see 20260709120000_add_storage_and_books): the pooled DB
-- role can't create/reference objects there. Enforced at the app layer.

-- ---------------------------------------------------------------------------
-- CreateEnum
-- ---------------------------------------------------------------------------

CREATE TYPE "StudentResourceStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

CREATE TYPE "StudentResourceType" AS ENUM ('NOTE', 'PAST_QUESTION', 'STUDY_GUIDE', 'REFERENCE');

-- ---------------------------------------------------------------------------
-- CreateTable: rank_definitions
-- Fixed reference table (ten ranks, Novice -> Ultimate). Created first
-- since user_progressions depends on it. Deliberately NOT seeded here —
-- seeding is a separate, later step.
-- ---------------------------------------------------------------------------

CREATE TABLE "rank_definitions" (
    "id"                          TEXT        NOT NULL,
    "level"                       INTEGER     NOT NULL,
    "name"                        TEXT        NOT NULL,
    "minimum_approved_resources"  INTEGER     NOT NULL,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rank_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rank_definitions_level_key" ON "rank_definitions"("level");
CREATE UNIQUE INDEX "rank_definitions_name_key" ON "rank_definitions"("name");
CREATE UNIQUE INDEX "rank_definitions_minimum_approved_resources_key" ON "rank_definitions"("minimum_approved_resources");

-- ---------------------------------------------------------------------------
-- CreateTable: student_resources
-- A single academic resource a student submits for admin review. Never
-- hard-deleted once it has an attached ResourceContribution (see the
-- RESTRICT FK on user_id below and on resource_contributions further down).
-- ---------------------------------------------------------------------------

CREATE TABLE "student_resources" (
    "id"                        UUID                    NOT NULL DEFAULT gen_random_uuid(),
    "user_id"                   TEXT                    NOT NULL,
    "storage_object_id"         UUID                    NOT NULL,
    "title"                     TEXT                    NOT NULL,
    "description"               TEXT,
    "level"                     TEXT                    NOT NULL,
    "department"                TEXT                    NOT NULL,
    "course_code"               TEXT                    NOT NULL,
    "course_title"              TEXT                    NOT NULL,
    "resource_type"             "StudentResourceType"   NOT NULL,
    "file_format"               "FileFormat"             NOT NULL,
    "status"                    "StudentResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewed_by_admin_id"      TEXT,
    "reviewed_at"               TIMESTAMP(3),
    "approved_at"               TIMESTAMP(3),
    "rejection_reason"          TEXT,
    "submitted_at"              TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"                TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "student_resources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_resources_storage_object_id_key" ON "student_resources"("storage_object_id");

-- Supports the six-submission-per-day rate limit check
-- (COUNT ... WHERE userId = ? AND submittedAt >= today).
CREATE INDEX "student_resources_user_id_submitted_at_idx" ON "student_resources"("user_id", "submitted_at");

-- Supports the admin review queue (WHERE status = PENDING_REVIEW ORDER BY submittedAt).
CREATE INDEX "student_resources_status_submitted_at_idx" ON "student_resources"("status", "submitted_at");

-- Supports eventual student-resource discovery filtered by targeting + status.
CREATE INDEX "student_resources_level_department_status_idx" ON "student_resources"("level", "department", "status");

-- ForeignKey: RESTRICT, not CASCADE — cascading here would let PostgreSQL
-- attempt to delete a StudentResource that still has a Restrict-protected
-- ResourceContribution, which fails at the DB level once a user has any
-- accounting history. Account removal for such users must be implemented
-- as anonymization/deactivation, not a destructive delete.
ALTER TABLE "student_resources"
    ADD CONSTRAINT "student_resources_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- ForeignKey: nullable + SET NULL, matching the existing
-- Admin-authored-content pattern (NotificationCampaign.createdByAdmin,
-- AdminLoginEvent.adminId) — a removed reviewer admin must never block
-- deleting that admin's account, and the review decision itself survives
-- independently of who made it.
ALTER TABLE "student_resources"
    ADD CONSTRAINT "student_resources_reviewed_by_admin_id_fkey"
    FOREIGN KEY ("reviewed_by_admin_id")
    REFERENCES "Admin"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CreateTable: daily_goals
-- A per-student, per-day accounting container. Holds no progress counter —
-- completion is always derived by counting this row's active
-- ResourceContribution children.
-- ---------------------------------------------------------------------------

CREATE TABLE "daily_goals" (
    "id"             UUID          NOT NULL DEFAULT gen_random_uuid(),
    "user_id"        TEXT          NOT NULL,
    "activity_date"  DATE          NOT NULL,
    "created_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "daily_goals_pkey" PRIMARY KEY ("id")
);

-- Non-negotiable: exactly one goal container per student per calendar day.
CREATE UNIQUE INDEX "daily_goals_user_id_activity_date_key" ON "daily_goals"("user_id", "activity_date");

-- Supports admin reporting (e.g. "how many goals were completed on date X").
CREATE INDEX "daily_goals_activity_date_idx" ON "daily_goals"("activity_date");

-- ForeignKey: RESTRICT, matching student_resources.user_id — a DailyGoal
-- with Restrict-protected ResourceContribution children can't be cascaded
-- through, so the parent User can't be either.
ALTER TABLE "daily_goals"
    ADD CONSTRAINT "daily_goals_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CreateTable: resource_contributions
-- The immutable accounting ledger entry linking one approved
-- StudentResource to the DailyGoal it counted toward. A day's contribution
-- count and a student's lifetime approved-resource count are both derived
-- by counting these rows (excluding revoked ones).
-- ---------------------------------------------------------------------------

CREATE TABLE "resource_contributions" (
    "id"                    UUID          NOT NULL DEFAULT gen_random_uuid(),
    "student_resource_id"   UUID          NOT NULL,
    "daily_goal_id"         UUID          NOT NULL,
    "counted_at"            TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at"            TIMESTAMP(3),
    "revocation_reason"     TEXT,
    "created_at"            TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "resource_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resource_contributions_student_resource_id_key" ON "resource_contributions"("student_resource_id");

-- student_resource_id already has an implicit index via its own unique
-- constraint above; daily_goal_id does not, and every "how many active
-- contributions for this goal" / "is this goal complete" read filters on it.
CREATE INDEX "resource_contributions_daily_goal_id_idx" ON "resource_contributions"("daily_goal_id");

-- ForeignKey: RESTRICT, not CASCADE — a StudentResource with a contribution
-- must never be physically deletable; archive or revoke it instead,
-- preserving the audit trail this table exists to guarantee.
ALTER TABLE "resource_contributions"
    ADD CONSTRAINT "resource_contributions_student_resource_id_fkey"
    FOREIGN KEY ("student_resource_id")
    REFERENCES "student_resources"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- ForeignKey: RESTRICT, not CASCADE — a DailyGoal must never disappear out
-- from under contributions that still reference it.
ALTER TABLE "resource_contributions"
    ADD CONSTRAINT "resource_contributions_daily_goal_id_fkey"
    FOREIGN KEY ("daily_goal_id")
    REFERENCES "daily_goals"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CreateTable: user_progressions
-- Query-optimized snapshot of a student's progression, not the accounting
-- source of truth (that's resource_contributions). Must stay reconcilable
-- from contribution rows if it ever drifts.
-- ---------------------------------------------------------------------------

CREATE TABLE "user_progressions" (
    "id"                        UUID          NOT NULL DEFAULT gen_random_uuid(),
    "user_id"                   TEXT          NOT NULL,
    "rank_id"                   TEXT          NOT NULL,
    "approved_resource_count"   INTEGER       NOT NULL DEFAULT 0,
    "current_streak"            INTEGER       NOT NULL DEFAULT 0,
    "longest_streak"            INTEGER       NOT NULL DEFAULT 0,
    "last_completed_goal_date"  DATE,
    "created_at"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "user_progressions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_progressions_user_id_key" ON "user_progressions"("user_id");

-- user_id already has an implicit index via its own unique constraint
-- above; rank_id does not, and any "how many students are at rank X" /
-- rank-based leaderboard read filters on it.
CREATE INDEX "user_progressions_rank_id_idx" ON "user_progressions"("rank_id");

-- ForeignKey: CASCADE — this is a denormalized snapshot, not a ledger row,
-- so it is safe (and correct) for it to disappear along with its user.
ALTER TABLE "user_progressions"
    ADD CONSTRAINT "user_progressions_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "User"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ForeignKey: RESTRICT — a rank definition must never be deletable while a
-- student snapshot still points at it.
ALTER TABLE "user_progressions"
    ADD CONSTRAINT "user_progressions_rank_id_fkey"
    FOREIGN KEY ("rank_id")
    REFERENCES "rank_definitions"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- End of Gate 2 draft. NOT executed. No INSERT statements (rank rows are
-- not seeded here) and no ALTER of "User" or "Admin" beyond the FK
-- references above, which PostgreSQL requires to originate on the
-- referencing (new) table, not the referenced one.
