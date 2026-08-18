-- Fix: NotificationCampaign.created_by_admin_id was NOT NULL with an
-- implicit RESTRICT/NO ACTION delete behavior (from 20260815120000). That's
-- inconsistent with every other admin-linked audit column in this schema
-- (notifications.created_by_admin_id, "AdminLoginEvent".admin_id are both
-- nullable + SetNull) and means a removed/rogue Admin account could never
-- be deleted once they'd created a single campaign. This migration brings
-- it in line: the application still requires a known admin at campaign
-- *creation* time (see NotificationService.dispatchNotification), but the
-- database no longer blocks deleting that admin afterward.

-- Drop the old constraint before altering nullability — Postgres won't let
-- you change a column's NOT NULL status while a FK referencing it exists
-- with incompatible semantics in the same transaction without this order.
ALTER TABLE "notification_campaigns"
    DROP CONSTRAINT "notification_campaigns_created_by_admin_id_fkey";

ALTER TABLE "notification_campaigns"
    ALTER COLUMN "created_by_admin_id" DROP NOT NULL;

ALTER TABLE "notification_campaigns"
    ADD CONSTRAINT "notification_campaigns_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id")
    REFERENCES "Admin"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
