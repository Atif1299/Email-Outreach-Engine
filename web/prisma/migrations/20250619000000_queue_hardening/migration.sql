-- Remove duplicate successful sends, keeping the earliest per lead+campaign+step
DELETE FROM lead_sends a
USING lead_sends b
WHERE a.id > b.id
  AND a.lead_id = b.lead_id
  AND a.campaign_id = b.campaign_id
  AND a.step_order = b.step_order
  AND a.error IS NULL
  AND b.error IS NULL;

-- Partial unique index: only one successful send per lead+campaign+step
CREATE UNIQUE INDEX IF NOT EXISTS "lead_sends_success_unique"
ON "lead_sends" ("lead_id", "campaign_id", "step_order")
WHERE "error" IS NULL;
