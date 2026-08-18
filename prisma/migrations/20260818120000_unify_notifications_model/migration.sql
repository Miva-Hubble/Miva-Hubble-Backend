-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BROADCAST', 'TRANSACTIONAL', 'SYSTEM');

-- AlterTable
ALTER TABLE "notification_campaigns"
  ADD COLUMN "type" "NotificationType" NOT NULL DEFAULT 'BROADCAST',
  ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notification_campaigns_idempotency_key_key" ON "notification_campaigns"("idempotency_key");

-- DropTable (legacy flat notifications table)
DROP TABLE IF EXISTS "notifications" CASCADE;
