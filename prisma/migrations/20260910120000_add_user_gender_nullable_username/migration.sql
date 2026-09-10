-- MANUAL DRAFT. DO NOT EXECUTE until reviewed and applied via the normal
-- migration flow (prisma migrate deploy against development, then the same
-- unchanged file through CI/CD to production) — see README.md "Database
-- Migrations". This project has no isolated shadow database, so
-- `prisma migrate dev` / `migrate reset` / `db push` must never be run here.
--
-- Scope of this migration (nothing else):
--   * CREATE TYPE "Gender" (MALE, FEMALE — two values only, no OTHER)
--   * Add "User"."gender", nullable — unset until a user claims it.
--     Never-overwritten-once-set is a service-layer rule, not enforced here.
--   * Relax "User"."username" to nullable — auto-assignment is being
--     removed, so new users may not have one yet. Never-reverts-to-null
--     is a service-layer rule, not enforced here. The existing unique
--     constraint on username is left untouched: Postgres unique indexes
--     already permit multiple NULLs, so no index change is needed for
--     this relaxation.
--
-- Explicitly NOT in scope: "User"."profilePicturePath" is untouched.
-- Dropping it is a separate, later, destructive migration (Phase 6) and
-- must not be bundled with this additive-only change.
--
-- Additive only — no DROP TABLE, no DROP COLUMN, no data loss possible.

-- ---------------------------------------------------------------------------
-- CreateEnum
-- ---------------------------------------------------------------------------

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- ---------------------------------------------------------------------------
-- Add User.gender (nullable)
-- ---------------------------------------------------------------------------

ALTER TABLE "User" ADD COLUMN "gender" "Gender";

-- ---------------------------------------------------------------------------
-- Relax User.username to nullable (unique constraint untouched)
-- ---------------------------------------------------------------------------

ALTER TABLE "User" ALTER COLUMN "username" DROP NOT NULL;

-- End of draft. NOT executed.
