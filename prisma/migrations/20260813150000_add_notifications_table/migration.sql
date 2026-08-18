-- CreateEnum: Notification delivery channel
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'IN_APP');

-- CreateEnum: Notification lifecycle status (source of truth for delivery audit)
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'DELIVERED', 'FAILED');

-- CreateTable: notifications — Supabase PostgreSQL source of truth for every
-- notification event. Redis/BullMQ is only the transport; this table is the
-- permanent audit record that survives queue restarts and worker crashes.
CREATE TABLE "notifications" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    TEXT,
    "recipient"  TEXT         NOT NULL,
    "subject"    TEXT         NOT NULL,
    "body"       TEXT         NOT NULL,
    "channel"    "NotificationChannel"  NOT NULL DEFAULT 'EMAIL',
    "status"     "NotificationStatus"   NOT NULL DEFAULT 'PENDING',
    "attempts"   INTEGER      NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "metadata"   JSONB                  DEFAULT '{}',
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- ForeignKey: optional link back to the user who triggered this notification.
-- SetNull on delete so notification history is preserved even if the user
-- account is removed — important for audit compliance.
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- Indexes: primary query patterns are by userId (notification history) and
-- by status (queue health monitoring / retry sweeps).
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");
CREATE INDEX "notifications_status_idx"  ON "notifications"("status");
