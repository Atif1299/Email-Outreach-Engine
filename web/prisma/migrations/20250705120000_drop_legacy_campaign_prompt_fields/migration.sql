-- Drop legacy few-shot and ai_instructions columns from campaigns
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "few_shot_step1_json";
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "few_shot_step2_json";
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "ai_instructions";
