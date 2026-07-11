-- Disable hard follow-up ratio gate so due follow-ups send under daily caps only.
ALTER TABLE "settings" ALTER COLUMN "max_follow_up_ratio" SET DEFAULT 0;
UPDATE "settings" SET "max_follow_up_ratio" = 0;
