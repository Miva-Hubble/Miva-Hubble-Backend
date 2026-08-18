-- Add subject and channel to notification_campaigns
ALTER TABLE "notification_campaigns"
  ADD COLUMN "subject" TEXT,
  ADD COLUMN "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL';
