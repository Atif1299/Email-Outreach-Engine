-- Track first email open per send (tracking pixel)
ALTER TABLE "lead_sends" ADD COLUMN IF NOT EXISTS "opened_at" TIMESTAMP(3);
