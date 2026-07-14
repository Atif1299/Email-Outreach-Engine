# Email Outreach Engine

Cloud-based cold email outreach platform: import leads, build multi-step sequences, personalize with AI, send through your own Gmail SMTP accounts, track opens, and sync replies via IMAP.

**Live app:** [email-outreach-web (Cloud Run)](https://email-outreach-web-95044197271.europe-west1.run.app) · **Dashboard:** `/dashboard`

---

## What this system is

An operator tool for running outbound cold email at scale from a browser. You own the sending accounts (Gmail App Passwords). The app orchestrates:

1. **Lead intake** — CSV / Excel import with column mapping and local (plus optional ZeroBounce) verification  
2. **Campaign design** — pitch, voice, language, multi-step sequences with per-step delays  
3. **AI personalization** — OpenAI or Gemini drafts subject/body from your pitch and lead fields  
4. **Controlled sending** — multi-inbox rotation, daily/hourly/step caps, send windows, delays  
5. **Follow-ups** — later steps only after delays, stopped when someone replies / unsubscribes / OOOs / bounces  
6. **Inbox sync** — IMAP checks for engagement signals  
7. **Open tracking** — 1×1 pixel + unsubscribe links signed with HMAC  

Credentials for SMTP and AI live mainly in the app database (Connect settings), not only in host env vars.

---

## Architecture

```text
Browser (/dashboard)
        │
        ▼
Next.js 14 app (API routes + UI)
        │
        ├── PostgreSQL (Prisma)     ← campaigns, leads, queue, sends, inboxes
        ├── Gmail SMTP (Nodemailer) ← outbound mail
        ├── Gmail IMAP (imapflow)   ← replies / unsub / bounce
        └── OpenAI / Gemini         ← optional personalization

External cron (e.g. cron-job.org)
        ├── GET /api/cron/process-queue   → send batches
        └── GET /api/cron/check-inbox     → sync inboxes
```

| Layer | Choice |
|--------|--------|
| App | Next.js 14 (App Router), React 18, TypeScript, Tailwind |
| API | Next.js route handlers under `web/app/api/` |
| DB | PostgreSQL via Prisma (`DATABASE_DRIVER=postgres` for Supabase / standard Postgres; Neon adapter supported) |
| Mail | Nodemailer → `smtp.gmail.com:465`; IMAP → `imap.gmail.com:993` |
| AI | OpenAI SDK; OpenAI or Gemini models configured in Connect |
| Host | Google Cloud Run (`web/Dockerfile`, Node 20, standalone output, port `8080`) |
| Cron | External scheduler with `Authorization: Bearer <CRON_SECRET>` |

> The repo root also contains a legacy **Electron + SQLite** desktop app. The product described here is the **`web/`** Cloud application.

---

## Operator workflow (dashboard)

| Step | What you do |
|------|-------------|
| **Connect** | Add one or more Gmail inboxes (App Password), send delays, daily/hourly caps, Step‑1 vs follow‑up caps, send timezone/hours, AI keys, unsubscribe footer |
| **Import** | Upload `.csv` / `.xlsx`, map columns, create an import batch |
| **Leads** | Search/filter, verify, suppress / do-not-contact |
| **Campaign** | Pitch, sign-off, AI voice/language; multi-step sequence (templates and/or AI per step) |
| **Preview** | Merge preview, per-lead overrides, bulk AI, send a test email |
| **Queue** | Start / pause / resume / stop; multi-campaign fairness; open-rate and send stats |
| **Replies** | View reply / unsubscribe / OOO / bounce engagement from IMAP sync |

Marketing site: `/`, `/platform`, `/deliverability`.

---

## Sending & cron

With `NEXT_PUBLIC_USE_CRON_WORKER=true` (production default on Cloud Run), the queue does **not** rely on an open browser tab.

| Endpoint | Role |
|----------|------|
| `/api/cron/process-queue` | Process due sends under rate limits and time budget |
| `/api/cron/check-inbox` | Sync Gmail for replies, unsubscribes, bounces, OOO |

```http
Authorization: Bearer <CRON_SECRET>
```

Suggested schedules: queue every **10–15 minutes**, inbox every **~30 minutes** (adjust to volume).

Without the cron worker flag, the queue can tick from the dashboard via `/api/queue/tick` while the tab is open. Manual inbox sync is also available from Replies / Queue.

---

## Multi-inbox, follow-ups, tracking

- **Multi-inbox** — Multiple SMTP accounts; sticky assignment per lead+campaign; rotation with per-inbox health and caps  
- **Follow-ups** — `CampaignStep` delays after previous send; engagement stops further steps  
- **Open tracking** — Pixel → `/api/track/open` → `lead_sends.opened_at`  
- **Unsubscribe** — Footer / List-Unsubscribe style links → `/api/track/unsubscribe`  
- Requires production `NEXT_PUBLIC_APP_URL` + `TRACKING_SECRET` (or `CRON_SECRET`)

---

## Repository layout

```text
Email-Outreach-Engine/
├── README.md                 # This file
├── render.yaml               # Optional Render blueprint
├── main.js, renderer.js, …   # Legacy Electron desktop app
└── web/                      # ← Production Cloud app
    ├── app/
    │   ├── (marketing)/      # Landing / platform / deliverability
    │   ├── dashboard/        # Operator UI
    │   └── api/              # Import, campaigns, queue, cron, track, …
    ├── components/dashboard/ # Connect → Replies steps
    ├── components/marketing/
    ├── lib/                  # db, smtp, queue, inbox, ai, verify, …
    ├── prisma/               # Schema + migrations
    ├── prompts/cold_outreach/
    ├── Dockerfile            # Cloud Run image
    └── scripts/              # DB helper scripts
```

---

## Local development

```bash
cd web
npm install
```

Create `web/.env.local`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require"
DATABASE_DRIVER="postgres"
CRON_SECRET="generate-a-long-random-string"
TRACKING_SECRET="generate-a-long-random-string"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_USE_CRON_WORKER="false"
# Optional
OPENAI_API_KEY=""
```

```bash
npx prisma db push
npx prisma generate
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard). Configure Gmail inboxes in **Connect** (App Password, not your normal Google password).

---

## Production (Google Cloud Run)

Deploy from repo root (project must have Cloud Run + Cloud Build + Artifact Registry):

```bash
gcloud run deploy email-outreach-web \
  --source=web \
  --region=europe-west1 \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --project=YOUR_GCP_PROJECT_ID
```

Set on the service (example):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres URI (use Supabase **session pooler** if using Supabase) |
| `DATABASE_DRIVER` | `postgres` |
| `CRON_SECRET` | Bearer token for cron routes |
| `TRACKING_SECRET` | HMAC for open/unsubscribe tokens |
| `NEXT_PUBLIC_APP_URL` | Public Cloud Run HTTPS origin |
| `NEXT_PUBLIC_USE_CRON_WORKER` | `true` |

Point your external cron at:

- `{NEXT_PUBLIC_APP_URL}/api/cron/process-queue`  
- `{NEXT_PUBLIC_APP_URL}/api/cron/check-inbox`  

---

## Gmail setup

1. Enable 2-Step Verification on the Google account  
2. Create an [App Password](https://support.google.com/accounts/account-password)  
3. In **Connect**: username = full Gmail address, password = App Password  
4. SMTP: `smtp.gmail.com` / `465` / secure; IMAP: `imap.gmail.com` / `993`  

Deliverability (inbox vs spam) depends on Gmail reputation, send pace, content, and link domains — not only on hosting. Prefer conservative caps and delays for cold outreach.

---

## Data model (high level)

Core Prisma models: `Lead`, `ImportBatch`, `Campaign`, `CampaignStep`, `LeadSend`, `SmtpAccount`, `LeadSmtpAssignment`, `LeadCampaignEngagement`, `Settings`, `QueueState`, `InboxSyncState`, plus AI bulk / preview override tables.

All campaign and queue state lives in Postgres — no spreadsheet is required after import.

---

## License

See repository license file if present; otherwise treat as private unless stated otherwise.
