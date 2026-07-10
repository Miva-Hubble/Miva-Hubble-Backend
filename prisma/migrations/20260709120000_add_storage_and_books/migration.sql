-- CreateEnum
CREATE TYPE "BookType" AS ENUM ('TEXTBOOK', 'PAST_QUESTION', 'STUDY_GUIDE', 'REFERENCE');
CREATE TYPE "BookStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable (User Files)
CREATE TABLE "user_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "storage_object_id" UUID NOT NULL,
    "custom_label" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable (Books)
CREATE TABLE "books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_object_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "description" TEXT,
    "level" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "book_type" "BookType" NOT NULL,
    "status" "BookStatus" NOT NULL DEFAULT 'DRAFT',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX "user_files_storage_object_id_key" ON "user_files"("storage_object_id");
CREATE UNIQUE INDEX "books_storage_object_id_key" ON "books"("storage_object_id");
CREATE INDEX "user_files_user_id_idx" ON "user_files"("user_id");
CREATE INDEX "books_status_idx" ON "books"("status");

-- Foreign Keys (public schema)
ALTER TABLE "user_files" ADD CONSTRAINT "user_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- storage_object_id on both tables intentionally has no DB-level foreign
-- key into Supabase's managed "storage" schema (the pooled DB role can't
-- create or reference objects there). Referential integrity against
-- storage.objects is enforced at the application layer instead.
