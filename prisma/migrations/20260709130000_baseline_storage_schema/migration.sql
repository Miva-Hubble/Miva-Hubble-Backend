-- This migration originally attempted to baseline Supabase's entire
-- managed "storage" schema into Prisma's migration history, to satisfy a
-- cross-schema foreign key from public.books/user_files into
-- storage.objects. That FK has since been dropped (see
-- 20260709140000_drop_storage_fk), so Prisma no longer needs to track or
-- understand the "storage" schema at all. This file is intentionally a
-- no-op, kept only so migration history stays continuous.
SELECT 1;
