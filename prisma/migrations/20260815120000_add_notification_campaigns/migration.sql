-- Phase 1: Campaign / Recipient / Delivery Event model for admin bulk
-- notifications (targeted by student level). The flat "notifications" table
-- (added in 20260813150000) is kept as-is and remains the home for
-- system/transactional single-recipient sends (e.g. onboarding welcome
-- email) — this migration is additive, not a replacement.

-- CreateEnum: campaign lifecycle status
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum: immutable per-recipient delivery event log entries
CREATE TYPE "DeliveryEventType" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'RETRYING');

-- CreateTable: notification_campaigns — one row per admin bulk-send action.
-- targetLevels drives eligible-recipient resolution (see
-- notification-campaign.repository.ts findEligibleUsersByLevels).
CREATE TABLE "notification_campaigns" (
    "id"                   UUID            NOT NULL DEFAULT gen_random_uuid(),
    "title"                TEXT            NOT NULL,
    "message"              TEXT            NOT NULL,
    "targetLevels"         TEXT[]          NOT NULL DEFAULT '{}',
    "targetDepartments"    TEXT[]          NOT NULL DEFAULT '{}',
    "status"               "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "recipient_count"      INTEGER         NOT NULL DEFAULT 0,
    "metadata"             JSONB           DEFAULT '{}',
    "created_by_admin_id"  TEXT            NOT NULL,
    "scheduled_at"         TIMESTAMPTZ,
    "completed_at"         TIMESTAMPTZ,
    "created_at"           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT "notification_campaigns_pkey" PRIMARY KEY ("id")
);

-- ForeignKey: campaign creator is required (not nullable) — unlike
-- Notification.createdByAdminId, a campaign must always have a known author.
ALTER TABLE "notification_campaigns"
    ADD CONSTRAINT "notification_campaigns_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id")
    REFERENCES "Admin"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- CreateTable: notification_recipients — one row per resolved eligible
-- student per campaign. This is the fan-out table that lets us answer
-- "who got this and what's their individual delivery status" instead of
-- only having an aggregate campaign-level status.
CREATE TABLE "notification_recipients" (
    "id"                   UUID                NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id"          UUID                NOT NULL,
    "user_id"              TEXT,
    "email"                TEXT                NOT NULL,
    "status"               "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"             INTEGER             NOT NULL DEFAULT 0,
    "last_error"           TEXT,
    "provider_message_id"  TEXT,
    "sent_at"              TIMESTAMPTZ,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

-- ForeignKey: cascade delete with the campaign — recipients have no meaning
-- without their parent campaign.
ALTER TABLE "notification_recipients"
    ADD CONSTRAINT "notification_recipients_campaign_id_fkey"
    FOREIGN KEY ("campaign_id")
    REFERENCES "notification_campaigns"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ForeignKey: SetNull so recipient/delivery history survives a student
-- account deletion, matching the notifications.user_id pattern.
ALTER TABLE "notification_recipients"
    ADD CONSTRAINT "notification_recipients_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- Idempotency: resolving eligible users for the same campaign twice (e.g. a
-- retried request) must not create duplicate recipient rows for the same
-- student.
CREATE UNIQUE INDEX "notification_recipients_campaign_id_user_id_key" ON "notification_recipients"("campaign_id", "user_id");
CREATE INDEX "notification_recipients_campaign_id_idx" ON "notification_recipients"("campaign_id");
CREATE INDEX "notification_recipients_user_id_idx" ON "notification_recipients"("user_id");

-- CreateTable: notification_delivery_events — immutable, append-only audit
-- log per recipient. Answers "why didn't this specific student get the
-- email" with a real timeline instead of only a final status value.
CREATE TABLE "notification_delivery_events" (
    "id"                          UUID              NOT NULL DEFAULT gen_random_uuid(),
    "notification_recipient_id"   UUID              NOT NULL,
    "event"                       "DeliveryEventType" NOT NULL,
    "provider"                    TEXT,
    "provider_message_id"         TEXT,
    "metadata"                    JSONB             DEFAULT '{}',
    "created_at"                  TIMESTAMPTZ       NOT NULL DEFAULT now(),

    CONSTRAINT "notification_delivery_events_pkey" PRIMARY KEY ("id")
);

-- ForeignKey: RESTRICT (not CASCADE/SetNull) on delete — a recipient row
-- must never be deletable while it still has delivery history, since that
-- history is the audit trail. This is deliberate: it's the same guarantee
-- the Prisma schema comment describes ("immutable audit trail").
ALTER TABLE "notification_delivery_events"
    ADD CONSTRAINT "notification_delivery_events_notification_recipient_id_fkey"
    FOREIGN KEY ("notification_recipient_id")
    REFERENCES "notification_recipients"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

CREATE INDEX "notification_delivery_events_notification_recipient_id_idx" ON "notification_delivery_events"("notification_recipient_id");
