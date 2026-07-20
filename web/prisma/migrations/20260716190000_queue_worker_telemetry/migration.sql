ALTER TABLE "queue_state"
ADD COLUMN "last_cron_at" TIMESTAMP(3),
ADD COLUMN "last_cron_status" TEXT,
ADD COLUMN "last_cron_processed" INTEGER NOT NULL DEFAULT 0;
