-- Fix outbox_jobs.campaign_id: live DB had it as text, schema expects uuid.
-- Existing values are all valid UUID strings (verified before this migration),
-- so this is a safe in-place cast rather than the drop/recreate `prisma db push`
-- was proposing.
ALTER TABLE "outbox_jobs" ALTER COLUMN "campaign_id" TYPE UUID USING "campaign_id"::uuid;
