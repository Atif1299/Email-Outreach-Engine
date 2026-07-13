# Migrate Neon + Vercel → Supabase + Render (free, keep all campaigns)

Your campaigns, sends, queue state, inboxes, and leads live in **Postgres**.  
Copy the database → point the app at the new URL → outreach continues where it stopped.

## What I cannot do for you (needs your login)

| Step | Why |
|------|-----|
| Export from Neon | Your Neon account + connection string |
| Create Supabase project | Your Supabase account |
| Import backup into Supabase | Your Supabase connection string |
| Create Render service | Your Render + GitHub login |
| Paste env secrets | SMTP passwords, OpenAI key, etc. |

The repo is ready for **Supabase Postgres + Render hosting**. Follow the steps below once.

---

## Part 1 — Backup Neon (do this first)

1. Open [console.neon.tech](https://console.neon.tech) → project **Cloud Email Outreach Web Application**.
2. If the dashboard still loads, go to **Connection details** and copy the **direct** Postgres URL.
3. On your PC (install [PostgreSQL tools](https://www.postgresql.org/download/windows/) for `pg_dump`):

```powershell
cd D:\Products\Email-Outreach-Engine\web\scripts
$env:NEON_URL = "postgresql://USER:PASS@HOST/neondb?sslmode=require"
pg_dump $env:NEON_URL -F c -f ..\..\outreach_backup.dump
```

4. Verify the file exists and is not 0 bytes.

**If export fails today:** wait for Neon’s **monthly reset** (email says when), export **immediately**, then continue. Do **not** delete the Neon project.

---

## Part 2 — Supabase (free database)

1. [supabase.com](https://supabase.com) → **New project** (free).
2. **Project Settings → Database** → copy **URI** (direct connection, port 5432).
3. Import backup:

```powershell
$env:SUPABASE_URL = "postgresql://postgres:YOUR_PASSWORD@db.xxxx.supabase.co:5432/postgres"
pg_restore -d $env:SUPABASE_URL --no-owner --no-acl --clean --if-exists ..\..\outreach_backup.dump
```

4. Verify in Supabase **SQL Editor**:

```sql
SELECT COUNT(*) AS campaigns FROM campaigns;
SELECT COUNT(*) AS sends FROM lead_sends;
SELECT running, active_campaigns_json FROM queue_state WHERE id = 1;
```

You should see your real numbers.

**Connection string for the app (Render):**  
Use the same URI. For serverless you can append `?pgbouncer=true&connection_limit=1` if Supabase offers a pooler URL — optional on Render.

Set `DATABASE_DRIVER=postgres` (Render blueprint sets this automatically).

---

## Part 3 — Deploy on Render (free app)

1. Push this repo to GitHub (if not already).
2. [render.com](https://render.com) → **New → Blueprint** → connect repo → use root `render.yaml`.
3. In **Environment**, add (copy from old Vercel project):

| Variable | Required |
|----------|----------|
| `DATABASE_URL` | Supabase URI |
| `DATABASE_DRIVER` | `postgres` |
| `CRON_SECRET` | same as before |
| `TRACKING_SECRET` | same as before |
| `NEXT_PUBLIC_APP_URL` | `https://YOUR-SERVICE.onrender.com` |
| `NEXT_PUBLIC_USE_CRON_WORKER` | `true` |
| `OPENAI_API_KEY` | if you use AI |
| `SMTP_PASSWORD` | only if used globally (inboxes are in DB) |

4. Deploy. Open `https://YOUR-SERVICE.onrender.com/dashboard`.
5. **Connect** step should load settings (no “Failed to get settings”).

---

## Part 4 — Cron (keep campaigns sending)

Update [cron-job.org](https://cron-job.org) (or your scheduler) URLs:

| Job | URL | Suggested (free tier) |
|-----|-----|------------------------|
| Queue | `GET https://YOUR-SERVICE.onrender.com/api/cron/process-queue` | Every **10–15 min** |
| Inbox | `GET https://YOUR-SERVICE.onrender.com/api/cron/check-inbox` | Every **30 min** |

Header: `Authorization: Bearer YOUR_CRON_SECRET`

**Why slower cron?** Free Neon/Vercel limits came from 5‑min cron + 3 campaigns + 4 inboxes. 10–15 min still sends; it uses less CPU and DB bandwidth.

---

## Part 5 — Resume outreach

1. Open **Queue** — active campaigns should appear if `queue_state` migrated.
2. If queue shows stopped, select the same campaigns and **Start** again.
3. The engine reads **`lead_sends`** — leads who already got Step 1/2/3 will **not** be sent again.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Failed to get settings | Check `DATABASE_URL`, Supabase project not paused |
| Render slow first load | Free tier sleeps ~15 min idle — normal |
| pg_restore errors on Supabase | Try without `--clean`; or export from Neon as `.sql` and run in SQL Editor |
| Still on Neon URL in Vercel | Stop Vercel cron jobs so you don’t double-send |

---

## Optional: keep Vercel as backup UI only

Not recommended (two hosts, one DB). Prefer **one host: Render** + **one DB: Supabase**.
