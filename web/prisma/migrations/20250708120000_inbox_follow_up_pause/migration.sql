-- Per-inbox follow-up pause after Gmail blocks (scoped reputation protection)

ALTER TABLE "smtp_accounts" ADD COLUMN IF NOT EXISTS "follow_ups_paused_until" TIMESTAMP(3);
