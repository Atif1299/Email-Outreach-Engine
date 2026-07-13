-- CreateTable
CREATE TABLE "import_batches" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "import_batch_id" INTEGER,
    "email" TEXT NOT NULL,
    "data_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verification_status" TEXT NOT NULL DEFAULT 'pending',
    "verification_reason" TEXT,
    "verified_at" TIMESTAMP(3),
    "verification_method" TEXT,
    "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
    "do_not_contact_at" TIMESTAMP(3),
    "do_not_contact_reason" TEXT,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "pitch_block" TEXT NOT NULL DEFAULT '',
    "sender_info" TEXT NOT NULL DEFAULT '',
    "ai_voice" TEXT NOT NULL DEFAULT 'founder',
    "output_language" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_steps" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "step_order" INTEGER NOT NULL,
    "delay_hours_after_previous" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subject_template" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "use_ai" BOOLEAN NOT NULL DEFAULT false,
    "body_format" TEXT NOT NULL DEFAULT 'plain',

    CONSTRAINT "campaign_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_target_batches" (
    "campaign_id" INTEGER NOT NULL,
    "import_batch_id" INTEGER NOT NULL,

    CONSTRAINT "campaign_target_batches_pkey" PRIMARY KEY ("campaign_id","import_batch_id")
);

-- CreateTable
CREATE TABLE "lead_sends" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "step_order" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body_snippet" TEXT,
    "smtp_message_id" TEXT,
    "smtp_account_id" INTEGER,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "lead_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smtp_accounts" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "exhausted_until" TIMESTAMP(3),
    "exhaust_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "last_inbox_checked_at" TIMESTAMP(3),
    "last_inbox_error" TEXT,
    "warmup_started_at" TIMESTAMP(3),
    "warmup_enabled" BOOLEAN NOT NULL DEFAULT false,
    "health_status" TEXT NOT NULL DEFAULT 'healthy',
    "health_changed_at" TIMESTAMP(3),
    "recovery_until" TIMESTAMP(3),
    "follow_ups_paused_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smtp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_smtp_assignments" (
    "lead_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "smtp_account_id" INTEGER NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_smtp_assignments_pkey" PRIMARY KEY ("lead_id","campaign_id")
);

-- CreateTable
CREATE TABLE "lead_campaign_engagements" (
    "lead_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "replied_at" TIMESTAMP(3),
    "unsubscribed_at" TIMESTAMP(3),
    "reply_subject" TEXT,
    "reply_snippet" TEXT,
    "detected_via" TEXT,
    "inbox_account_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_campaign_engagements_pkey" PRIMARY KEY ("lead_id","campaign_id")
);

-- CreateTable
CREATE TABLE "inbox_sync_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_body_overrides" (
    "lead_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "step_order" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "subject" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_body_overrides_pkey" PRIMARY KEY ("lead_id","campaign_id","step_order")
);

-- CreateTable
CREATE TABLE "lead_merge_previews" (
    "lead_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "step_order" INTEGER NOT NULL,
    "preview_text" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_merge_previews_pkey" PRIMARY KEY ("lead_id","campaign_id","step_order")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "smtp_host" TEXT NOT NULL DEFAULT 'smtp.gmail.com',
    "smtp_port" INTEGER NOT NULL DEFAULT 465,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT true,
    "smtp_user" TEXT NOT NULL DEFAULT '',
    "smtp_password" TEXT NOT NULL DEFAULT '',
    "smtp_from_name" TEXT NOT NULL DEFAULT '',
    "smtp_from_email" TEXT NOT NULL DEFAULT '',
    "send_delay_min_ms" INTEGER NOT NULL DEFAULT 60000,
    "send_delay_max_ms" INTEGER NOT NULL DEFAULT 240000,
    "daily_cap" INTEGER NOT NULL DEFAULT 300,
    "daily_step1_cap" INTEGER NOT NULL DEFAULT 0,
    "daily_follow_up_cap" INTEGER NOT NULL DEFAULT 0,
    "hourly_cap" INTEGER NOT NULL DEFAULT 25,
    "send_timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "send_start_hour" INTEGER NOT NULL DEFAULT 12,
    "openai_key" TEXT NOT NULL DEFAULT '',
    "openai_model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "ai_provider" TEXT NOT NULL DEFAULT 'openai',
    "gemini_api_key" TEXT NOT NULL DEFAULT '',
    "gemini_model" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    "verification_provider" TEXT NOT NULL DEFAULT 'none',
    "verification_api_key" TEXT NOT NULL DEFAULT '',
    "unsubscribe_enabled" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribe_footer_text" TEXT NOT NULL DEFAULT '',
    "max_follow_up_ratio" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "last_error" TEXT,
    "processed_in_session" INTEGER NOT NULL DEFAULT 0,
    "failed_in_session" INTEGER NOT NULL DEFAULT 0,
    "session_started_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "active_campaign_id" INTEGER,
    "active_lead_ids_json" TEXT NOT NULL DEFAULT '[]',
    "skipped_lead_ids_json" TEXT NOT NULL DEFAULT '[]',
    "active_campaigns_json" TEXT NOT NULL DEFAULT '[]',
    "last_served_campaign_id" INTEGER,
    "processing_lock_until" TIMESTAMP(3),
    "next_send_allowed_at" TIMESTAMP(3),
    "follow_ups_paused_until" TIMESTAMP(3),
    "cluster_breaker_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_bulk_jobs" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "step_order" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "regenerate_all" BOOLEAN NOT NULL DEFAULT false,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "generated" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "pending_lead_ids_json" TEXT NOT NULL DEFAULT '[]',
    "failed_lead_ids_json" TEXT NOT NULL DEFAULT '[]',
    "batch_pause_until" TIMESTAMP(3),
    "batch_window_started_at" TIMESTAMP(3),
    "leads_in_window" INTEGER NOT NULL DEFAULT 0,
    "processing_lock_until" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_bulk_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "leads_import_batch_id_idx" ON "leads"("import_batch_id");

-- CreateIndex
CREATE INDEX "leads_verification_status_idx" ON "leads"("verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_steps_campaign_id_step_order_key" ON "campaign_steps"("campaign_id", "step_order");

-- CreateIndex
CREATE INDEX "lead_sends_lead_id_campaign_id_idx" ON "lead_sends"("lead_id", "campaign_id");

-- CreateIndex
CREATE INDEX "lead_sends_smtp_account_id_sent_at_idx" ON "lead_sends"("smtp_account_id", "sent_at");

-- CreateIndex
CREATE INDEX "smtp_accounts_enabled_sort_order_idx" ON "smtp_accounts"("enabled", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "smtp_accounts_email_key" ON "smtp_accounts"("email");

-- CreateIndex
CREATE INDEX "lead_campaign_engagements_campaign_id_status_idx" ON "lead_campaign_engagements"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "ai_bulk_jobs_campaign_id_step_order_status_idx" ON "ai_bulk_jobs"("campaign_id", "step_order", "status");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_target_batches" ADD CONSTRAINT "campaign_target_batches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_target_batches" ADD CONSTRAINT "campaign_target_batches_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sends" ADD CONSTRAINT "lead_sends_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sends" ADD CONSTRAINT "lead_sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sends" ADD CONSTRAINT "lead_sends_smtp_account_id_fkey" FOREIGN KEY ("smtp_account_id") REFERENCES "smtp_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_smtp_assignments" ADD CONSTRAINT "lead_smtp_assignments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_smtp_assignments" ADD CONSTRAINT "lead_smtp_assignments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_smtp_assignments" ADD CONSTRAINT "lead_smtp_assignments_smtp_account_id_fkey" FOREIGN KEY ("smtp_account_id") REFERENCES "smtp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_campaign_engagements" ADD CONSTRAINT "lead_campaign_engagements_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_campaign_engagements" ADD CONSTRAINT "lead_campaign_engagements_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_campaign_engagements" ADD CONSTRAINT "lead_campaign_engagements_inbox_account_id_fkey" FOREIGN KEY ("inbox_account_id") REFERENCES "smtp_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_body_overrides" ADD CONSTRAINT "lead_body_overrides_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_body_overrides" ADD CONSTRAINT "lead_body_overrides_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_merge_previews" ADD CONSTRAINT "lead_merge_previews_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_merge_previews" ADD CONSTRAINT "lead_merge_previews_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_bulk_jobs" ADD CONSTRAINT "ai_bulk_jobs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "lead_sends_success_unique"
ON "lead_sends" ("lead_id", "campaign_id", "step_order")
WHERE "error" IS NULL;

INSERT INTO "settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO "queue_state" ("id") VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO "inbox_sync_state" ("id") VALUES (1) ON CONFLICT DO NOTHING;