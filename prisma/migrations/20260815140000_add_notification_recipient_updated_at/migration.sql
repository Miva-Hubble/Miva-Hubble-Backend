-- Adds an operational-visibility column to notification_recipients so an
-- operator can tell "how long has this row been stuck in PROCESSING"
-- directly from the row, without reconstructing the timeline from
-- notification_delivery_events.
--
-- DEFAULT CURRENT_TIMESTAMP backfills existing rows with a sane value (their
-- migration-run time) instead of leaving them NULL. Prisma's @updatedAt then
-- takes over and stamps this column on every future update via the client
-- (application-level, not a DB trigger) — the DEFAULT here only covers the
-- one-time backfill and any raw SQL writes that bypass Prisma.

ALTER TABLE "notification_recipients"
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
