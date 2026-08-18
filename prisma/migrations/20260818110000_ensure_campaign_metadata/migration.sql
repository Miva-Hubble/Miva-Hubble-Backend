-- Ensure metadata column exists on notification_campaigns
ALTER TABLE "notification_campaigns"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}';
