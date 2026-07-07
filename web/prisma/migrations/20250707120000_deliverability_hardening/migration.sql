-- Deliverability hardening: inbox health, unsubscribe settings, follow-up governance

ALTER TABLE "smtp_accounts" ADD COLUMN IF NOT EXISTS "health_status" TEXT NOT NULL DEFAULT 'healthy';
ALTER TABLE "smtp_accounts" ADD COLUMN IF NOT EXISTS "health_changed_at" TIMESTAMP(3);
ALTER TABLE "smtp_accounts" ADD COLUMN IF NOT EXISTS "recovery_until" TIMESTAMP(3);

ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "unsubscribe_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "unsubscribe_footer_text" TEXT NOT NULL DEFAULT '';
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "max_follow_up_ratio" DOUBLE PRECISION NOT NULL DEFAULT 0.4;

ALTER TABLE "queue_state" ADD COLUMN IF NOT EXISTS "follow_ups_paused_until" TIMESTAMP(3);
ALTER TABLE "queue_state" ADD COLUMN IF NOT EXISTS "cluster_breaker_until" TIMESTAMP(3);
