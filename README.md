<p align="center">
  <img src="./docs/readme-banner.svg" alt="Email Outreach" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white" alt="OpenAI" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

<p align="center">
  <strong>Import your leads. Build sequences. Personalize with AI. Send through your SMTP — with pacing you control.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a>
  &nbsp;·&nbsp;
  <a href="#capabilities">Capabilities</a>
  &nbsp;·&nbsp;
  <a href="#workflow">Workflow</a>
  &nbsp;·&nbsp;
  <a href="#data-storage">Data</a>
  &nbsp;·&nbsp;
  <a href="#repository-layout">Layout</a>
  &nbsp;·&nbsp;
  <a href="#email-verification">Verification</a>
  &nbsp;·&nbsp;
  <a href="#compliance-and-deliverability">Compliance</a>
</p>

---

## What is Email Outreach?

Email Outreach is a **desktop operator tool** for teams that export contacts from LinkedIn or other sources as spreadsheets. You bring the file; the app handles **column mapping**, **merge-field templates**, **multi-step follow-ups** timed by hours after the previous send, and **SMTP delivery** through your own account so credentials stay under your control.

The workflow is intentionally linear: connect mail settings, import data, review leads, save a campaign definition, preview personalized content, then start a queue that respects **delay between messages** and a **daily cap**. Optional **OpenAI** integration can draft subject lines and bodies from your pitch block and lead fields when you enable it per step.

Data lives on disk in **SQLite**. SMTP passwords and API keys use Electron **`safeStorage`** where the operating system provides keychain-backed encryption.

## Capabilities

- **Import** — `.csv`, `.xlsx`, `.xls` with preview and column mapping; rows without a valid email are skipped; **local verification runs on import**.
- **Leads** — Search, filter by batch or verification status, select recipients, bulk delete, **Verify Batch / Verify Selected**.
- **Email verification** — Syntax, MX, disposable domain, and role-address checks locally; optional **ZeroBounce** deep verify when an API key is configured.
- **Campaigns** — Pitch block, sender sign-off, target batch, multi-step sequences with Overview and Sequences tabs.
- **Optional AI** — OpenAI-backed subject and body per lead when configured.
- **Preview** — Merge preview, per-lead AI generation, bulk AI, saved overrides.
- **Sending** — Nodemailer over SMTP; configurable inter-send delay, daily cap, pause/resume/stop.

## Requirements

- **Node.js** 18+ (LTS recommended).
- **Windows, macOS, or Linux** for development and runtime.

For Gmail SMTP, use an [App Password](https://support.google.com/accounts/answer/185833) with 2-Step Verification enabled.

## Quick start

```bash
git clone https://github.com/Atif1299/Email-Outreach-Engine.git
cd Email-Outreach-Engine
npm install
npm run rebuild
npm start


```

`npm run rebuild` compiles `better-sqlite3` for your Electron version. Run it again after upgrading Electron or Node.

Configure SMTP (and optionally OpenAI) in the **Connect** step before sending.

## Workflow

| Step | Purpose |
|------|---------|
| **Connect** | SMTP settings, send delays, daily cap, OpenAI API key, optional verification provider |
| **Import** | Upload leads, map columns, import batch (local verify on commit) |
| **Leads** | Review, search, filter by status, verify batch or selected leads |
| **Campaign** | Create campaign — Overview (pitch, sign-off) + Sequences (email steps) |
| **Preview** | Merge or AI-generate subject and body per lead |
| **Queue** | Start, pause, resume, or stop the send queue (**valid leads only**) |

## Email verification

Verification runs **before outreach** so bad addresses are filtered out early. Only leads with status **`valid`** appear in Preview lead counts and can be sent from the Queue.

```text
Import → local verify → Leads (status column) → optional API verify → Queue (valid only)
```

### Status meanings

| Status | Meaning | Can send? |
|--------|---------|-----------|
| **valid** | Passed checks (and API if used) | Yes |
| **invalid** | Bad syntax, no MX, disposable domain, API reject, or hard bounce after send | No |
| **risky** | Role address (`info@`, `admin@`, etc.) or catch-all from API | No |
| **pending** | Imported, not yet re-verified | No |
| **unknown** | API timeout or inconclusive result | No |

### Local checks (always)

On import and on **Verify Batch / Verify Selected**, the app always runs:

1. Email syntax validation  
2. MX record lookup  
3. Disposable domain blocklist  
4. Role-address detection → marked **risky** (not invalid)

### Optional ZeroBounce API

On **Connect**, set **Provider** to ZeroBounce and paste your API key. **Verify Batch** and **Verify Selected** will then call ZeroBounce for leads that are pending, unknown, or risky (when you choose deep verify).

Without an API key, verification stays local-only — still useful, but cannot detect catch-alls or spam traps.

### Bounce feedback

If SMTP returns a hard bounce (`550`, mailbox not found, etc.), the lead is automatically marked **invalid** and skipped on future steps.

Verification **reduces** bounces but cannot eliminate them entirely. Pair it with conservative daily caps and the hard-bounce auto-suppress loop above.

## Data storage

App data is stored in Electron `userData` (not inside the project folder):

| OS | Path |
|----|------|
| Windows | `%APPDATA%\Email Outreach\` |
| macOS | `~/Library/Application Support/Email Outreach/` |
| Linux | `~/.config/Email Outreach/` |

| File | Purpose |
|------|---------|
| `outreach.db` | Leads, campaigns, send history, AI overrides |
| `settings.json` | SMTP/OpenAI settings (secrets encrypted via OS keychain when available) |

Uninstalling the app removes the program but **keeps** the data above. Delete that folder manually for a full reset.

## Configuration

### SMTP

| Field | Example |
|-------|---------|
| Host | `smtp.gmail.com` |
| Port | `465` (TLS) |
| Username | Full email address |
| Password | App password (Gmail) |
| From Name / From Email | What recipients see |

### Merge tags

```
{{first_name}}  {{last_name}}  {{email}}
{{current_employer}}  {{current_title}}
{{pitch_block}}  {{sender_info}}
```

### Writing great pitch blocks (for AI)

When AI is enabled on a sequence step, the model uses a **pain-first** framework: hook on their role's problem → tie to title/company → bridge your product → soft CTA. Give it structured input:

```
Product: Schmoozzer
For: sales teams on ActiveCampaign
Pain: replies leak across LinkedIn, email, WhatsApp; CRM notes go stale
Solution: multi-channel outreach in one flow, synced to CRM
Integrations/channels: LinkedIn, Instagram, email, WhatsApp, ActiveCampaign
Offer/CTA: 15-minute benchmark of outbound gaps
Proof (optional): teams book more meetings with cleaner follow-up
```

**AI Voice** (Campaign Overview): **Founder** uses "I built…"; **Company** uses "We help…". Add optional **AI Instructions** for tone tweaks.

Default AI model is **GPT-4o Mini** on the Connect step. You can switch to **GPT-4.1 Mini** in the Model dropdown.

## Repository layout

| Path | Role |
|------|------|
| `main.js` | Electron main process — IPC, SQLite, SMTP, AI, send queue, verification |
| `aiPrompts.js` | Pain-first AI prompt builder and pitch parser |
| `prompts/cold_outreach/` | Editable system prompts and few-shot example |
| `verify.js` | Email verification — local checks + ZeroBounce adapter |
| `preload.js` | Context bridge exposing `window.api` to the UI |
| `renderer.js` | UI logic and wizard flow |
| `index.html` | App layout |
| `styles.css` | Dark theme and component styles |
| `docs/` | README assets |

## Troubleshooting

**`better-sqlite3` errors after install**

```bash
npm run rebuild
```

**Gmail authentication failed**

- Use an App Password, not your normal Google password
- Set SMTP username to your full Gmail address

**Database corrupt (`SQLITE_CORRUPT`)**

Close the app and delete `outreach.db`, `outreach.db-wal`, and `outreach.db-shm` from the `userData` folder. The app creates a fresh database on next launch.

## Compliance and deliverability

Outbound cold email must comply with **CAN-SPAM**, **GDPR** (for EU/UK contacts), and your mail provider's policies. **Lawful basis, list sourcing, and message content remain your responsibility.**

### Recommended settings

| Setup | Daily cap | Delay between sends | Notes |
|-------|-----------|---------------------|-------|
| Personal Gmail | ≤50 | 15–45 seconds | App Password required; match From email to Gmail username |
| Google Workspace | Start ≤100 | 15–45 seconds | Use your domain; configure SPF/DKIM in Admin |
| Custom SMTP | Provider limits | 15–45 seconds | From domain must match authenticated domain |

### First run checklist

1. Connect SMTP on **Connect** and verify with a test address.
2. Import leads, create a campaign, generate **AI body + subject** per lead on **Preview**.
3. Send to **5–10 test leads** on **Queue**; check your inbox for bounce notices.
4. Scale slowly only if delivery looks clean.

Preview **Generate AI** saves a **unique subject and body per lead** for the queue to send.

## License

MIT
