-- CreateEnum
CREATE TYPE "storage"."buckettype" AS ENUM ('STANDARD', 'ANALYTICS', 'VECTOR');

-- DropForeignKey
ALTER TABLE "public"."AdminSession" DROP CONSTRAINT "AdminSession_adminId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AdminLoginEvent" DROP CONSTRAINT "AdminLoginEvent_adminId_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_files" DROP CONSTRAINT "user_files_user_id_fkey";

-- AlterTable
ALTER TABLE "public"."Onboarding" ALTER COLUMN "preferredMode" DROP DEFAULT;

-- DropTable
DROP TABLE "public"."Admin";

-- DropTable
DROP TABLE "public"."AdminSession";

-- DropTable
DROP TABLE "public"."AdminLoginEvent";

-- DropTable
DROP TABLE "public"."user_files";

-- DropTable
DROP TABLE "public"."books";

-- DropEnum
DROP TYPE "public"."AdminStatus";

-- DropEnum
DROP TYPE "public"."AdminLoginEventType";

-- DropEnum
DROP TYPE "public"."BookType";

-- DropEnum
DROP TYPE "public"."BookStatus";

-- CreateTable
CREATE TABLE "storage"."buckets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "public" BOOLEAN DEFAULT false,
    "avif_autodetection" BOOLEAN DEFAULT false,
    "file_size_limit" BIGINT,
    "allowed_mime_types" TEXT[],
    "owner_id" TEXT,
    "type" "storage"."buckettype" NOT NULL DEFAULT 'STANDARD',

    CONSTRAINT "buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage"."buckets_analytics" (
    "name" TEXT NOT NULL,
    "type" "storage"."buckettype" NOT NULL DEFAULT 'ANALYTICS',
    "format" TEXT NOT NULL DEFAULT 'ICEBERG',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "buckets_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage"."buckets_vectors" (
    "id" TEXT NOT NULL,
    "type" "storage"."buckettype" NOT NULL DEFAULT 'VECTOR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buckets_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage"."migrations" (
    "id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "hash" VARCHAR(40) NOT NULL,
    "executed_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage"."objects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bucket_id" TEXT,
    "name" TEXT,
    "owner" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "last_accessed_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "path_tokens" TEXT[] DEFAULT string_to_array(name, '/'::text),
    "version" TEXT,
    "owner_id" TEXT,
    "user_metadata" JSONB,

    CONSTRAINT "objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage"."s3_multipart_uploads" (
    "id" TEXT NOT NULL,
    "in_progress_size" BIGINT NOT NULL DEFAULT 0,
    "upload_signature" TEXT NOT NULL,
    "bucket_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "owner_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_metadata" JSONB,
    "metadata" JSONB,

    CONSTRAINT "s3_multipart_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage"."s3_multipart_uploads_parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "upload_id" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "part_number" INTEGER NOT NULL,
    "bucket_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "etag" TEXT NOT NULL,
    "owner_id" TEXT,
    "version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "s3_multipart_uploads_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage"."vector_indexes" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "bucket_id" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "distance_metric" TEXT NOT NULL,
    "metadata_configuration" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vector_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bname" ON "storage"."buckets"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "buckets_analytics_unique_name_idx" ON "storage"."buckets_analytics"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "migrations_name_key" ON "storage"."migrations"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "bucketid_objname" ON "storage"."objects"("bucket_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "idx_objects_bucket_id_name" ON "storage"."objects"("bucket_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "name_prefix_search" ON "storage"."objects"("name" ASC);

-- CreateIndex
CREATE INDEX "idx_multipart_uploads_list" ON "storage"."s3_multipart_uploads"("bucket_id" ASC, "key" ASC, "created_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vector_indexes_name_bucket_id_idx" ON "storage"."vector_indexes"("name" ASC, "bucket_id" ASC);

-- AddForeignKey
ALTER TABLE "storage"."objects" ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "storage"."s3_multipart_uploads" ADD CONSTRAINT "s3_multipart_uploads_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "storage"."s3_multipart_uploads_parts" ADD CONSTRAINT "s3_multipart_uploads_parts_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "storage"."s3_multipart_uploads_parts" ADD CONSTRAINT "s3_multipart_uploads_parts_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "storage"."s3_multipart_uploads"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "storage"."vector_indexes" ADD CONSTRAINT "vector_indexes_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets_vectors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

