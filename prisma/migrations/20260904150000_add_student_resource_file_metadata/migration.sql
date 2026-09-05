-- MANUAL DRAFT. DO NOT EXECUTE until reviewed and applied via the normal
-- migration flow (prisma migrate deploy against development, then the same
-- unchanged file through CI/CD to production) — see README.md "Database
-- Migrations". This project has no isolated shadow database, so
-- `prisma migrate dev` / `migrate reset` / `db push` must never be run here.
--
-- Scope of this migration (nothing else):
--   * Add storage_path, mime_type, size_bytes to student_resources
--   * Backfill all three from storage.objects for existing rows
--   * Enforce NOT NULL once backfilled
--
-- Security note (frontend/backend contract): storage_path is an
-- INTERNAL-ONLY column. It must never be serialized in any API response —
-- StudentResourceService.toPublicResource strips it before every controller
-- response. Clients are issued a short-lived signed URL instead, the same
-- pattern already used for admin-curated Book downloads/previews.
--
-- storage_object_id remains the stable, already-existing reference into
-- Supabase's storage.objects table; these three columns are a denormalized
-- read-optimization on top of it, not a replacement for it.

-- ---------------------------------------------------------------------------
-- Step 1: add as nullable so existing rows aren't rejected outright.
-- ---------------------------------------------------------------------------

ALTER TABLE "student_resources" ADD COLUMN IF NOT EXISTS "storage_path" TEXT;
ALTER TABLE "student_resources" ADD COLUMN IF NOT EXISTS "mime_type" TEXT;
ALTER TABLE "student_resources" ADD COLUMN IF NOT EXISTS "size_bytes" INTEGER;

-- ---------------------------------------------------------------------------
-- Step 2: backfill from storage.objects, keyed by the existing
-- storage_object_id FK — same metadata shape
-- (StudentResourceService.resolveObjectAndVerifyMetadata already reads:
-- metadata.size, metadata.mimetype / metadata.contentType).
-- ---------------------------------------------------------------------------

UPDATE "student_resources" sr
SET
    "storage_path" = so.name,
    "mime_type"    = COALESCE(so.metadata ->> 'mimetype', so.metadata ->> 'contentType'),
    "size_bytes"   = (so.metadata ->> 'size')::integer
FROM storage.objects so
WHERE so.id = sr.storage_object_id;

-- ---------------------------------------------------------------------------
-- Step 3: enforce NOT NULL now that every existing row is backfilled.
-- If this fails, it means a student_resources row's storage.objects
-- counterpart is missing or has incomplete metadata — investigate that row
-- before re-running, rather than relaxing this constraint.
-- ---------------------------------------------------------------------------

ALTER TABLE "student_resources" ALTER COLUMN "storage_path" SET NOT NULL;
ALTER TABLE "student_resources" ALTER COLUMN "mime_type" SET NOT NULL;
ALTER TABLE "student_resources" ALTER COLUMN "size_bytes" SET NOT NULL;

-- End of draft. NOT executed.
