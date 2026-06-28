ALTER TABLE "queue_state" ADD COLUMN IF NOT EXISTS "active_campaigns_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "queue_state" ADD COLUMN IF NOT EXISTS "last_served_campaign_id" INTEGER;

UPDATE queue_state
SET active_campaigns_json = json_build_array(
  json_build_object(
    'campaignId', active_campaign_id,
    'leadIds', active_lead_ids_json::json,
    'skippedLeadIds', skipped_lead_ids_json::json
  )
)::text
WHERE active_campaign_id IS NOT NULL
  AND (active_campaigns_json IS NULL OR active_campaigns_json = '[]');
