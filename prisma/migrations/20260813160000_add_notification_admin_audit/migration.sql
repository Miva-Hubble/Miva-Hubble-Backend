-- Phase 0 audit-trail fix: record which admin triggered a notification
-- dispatch. Previously the notifications table had no link back to the
-- authenticated admin, so a rogue/compromised admin account could send
-- arbitrary notifications with zero forensic trail (see Phase 0 QA report,
-- Critical #1).

ALTER TABLE "notifications"
    ADD COLUMN "created_by_admin_id" TEXT;

-- ForeignKey: optional link to the admin who triggered this dispatch.
-- SetNull on delete so notification history is preserved even if the admin
-- account is later removed — same pattern already used for
-- notifications_user_id_fkey and AdminLoginEvent.adminId.
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id")
    REFERENCES "Admin"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- Index: audit queries will commonly filter "all notifications sent by
-- admin X" (e.g. reviewing a suspected-compromised account's activity).
CREATE INDEX "notifications_created_by_admin_id_idx" ON "notifications"("created_by_admin_id");
