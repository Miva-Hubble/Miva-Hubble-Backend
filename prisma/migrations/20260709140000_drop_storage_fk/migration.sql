-- Drop cross-schema foreign keys to Supabase's managed "storage" schema.
--
-- These constraints referenced storage.objects (Supabase Storage's internal
-- table) directly at the database level. That created ongoing friction with
-- Prisma's shadow-database migrations, since Prisma has to fully understand
-- and replay the entire real Supabase "storage" schema structure to satisfy
-- them, and that schema is managed by Supabase, not us.
--
-- No files have been uploaded yet, so this is a safe, lossless change.
-- storageObjectId remains a unique UUID column on both tables; the
-- relationship to storage.objects is now enforced at the application layer
-- (when creating a UserFile/Book row, verify the storage object exists)
-- instead of via a DB-level FK constraint.
ALTER TABLE "public"."user_files" DROP CONSTRAINT IF EXISTS "user_files_storage_object_id_fkey";
ALTER TABLE "public"."books" DROP CONSTRAINT IF EXISTS "books_storage_object_id_fkey";
