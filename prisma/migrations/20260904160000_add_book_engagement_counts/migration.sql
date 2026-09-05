-- The Book Prisma model has exposed these counters since before this
-- migration was added, but older databases never received the physical
-- columns. Keep this migration idempotent so it also safely repairs a
-- development database that was previously changed manually.

ALTER TABLE "public"."books"
  ADD COLUMN IF NOT EXISTS "download_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "preview_count" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "books_status_download_count_idx"
  ON "public"."books" ("status", "download_count" DESC);

CREATE INDEX IF NOT EXISTS "books_status_preview_count_idx"
  ON "public"."books" ("status", "preview_count" DESC);
