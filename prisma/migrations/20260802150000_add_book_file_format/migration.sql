-- CreateEnum
CREATE TYPE "FileFormat" AS ENUM ('PDF', 'EPUB', 'DOC', 'DOCX');

-- AlterTable: add nullable first so existing rows can be backfilled before
-- the NOT NULL constraint is applied below.
ALTER TABLE "books" ADD COLUMN "file_format" "FileFormat";

-- Backfill: derive the format from the physical object's actual filename
-- rather than guessing, since storage.objects.name is the one place the
-- original extension is still recorded (Book itself never stored it).
UPDATE "books" b
SET "file_format" = CASE
  WHEN so.name ILIKE '%.pdf'  THEN 'PDF'::"FileFormat"
  WHEN so.name ILIKE '%.epub' THEN 'EPUB'::"FileFormat"
  WHEN so.name ILIKE '%.docx' THEN 'DOCX'::"FileFormat"
  WHEN so.name ILIKE '%.doc'  THEN 'DOC'::"FileFormat"
END
FROM storage.objects so
WHERE so.id = b.storage_object_id;

-- Rows whose physical object is already gone (see architecture-overview.md
-- §14.3 "Orphaned Storage Objects") have no filename left to derive from.
-- Every row predating this migration was uploaded back when only PDF/EPUB
-- were accepted, so PDF is a safe fallback rather than blocking the
-- NOT NULL constraint below.
UPDATE "books" SET "file_format" = 'PDF' WHERE "file_format" IS NULL;

-- All rows are now backfilled; enforce the constraint for every future row.
ALTER TABLE "books" ALTER COLUMN "file_format" SET NOT NULL;
