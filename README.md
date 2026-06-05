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
  <a href="#compliance-and-deliverability">Compliance</a>
</p>

---

## What is Email Outreach?

Email Outreach is a **desktop operator tool** for teams that export contacts from LinkedIn or other sources as spreadsheets. You bring the file; the app handles **column mapping**, **merge-field templates**, **multi-step follow-ups** timed by hours after the previous send, and **SMTP delivery** through your own account so credentials stay under your control.

The workflow is intentionally linear: connect mail settings, import data, review leads, save a campaign definition, preview personalized content, then start a queue that respects **delay between messages** and a **daily cap**. Optional **OpenAI** integration can draft subject lines and bodies from your pitch block and lead fields when you enable it per step.

Data lives on disk in **SQLite**. SMTP passwords and API keys use Electron **`safeStorage`** where the operating system provides keychain-backed encryption.

## Capabilities

- **Import** — `.csv`, `.xlsx`, `.xls` with preview and column mapping; rows without a valid email are skipped.
- **Leads** — Search, filter by batch, select recipients, bulk delete.
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
git clone <your-repository-url>
cd email-outreach-v2
npm install
npm run rebuild
npm start
```

`npm run rebuild` compiles `better-sqlite3` for your Electron version. Run it again after upgrading Electron or Node.

Configure SMTP (and optionally OpenAI) in the **Connect** step before sending.

## Workflow

| Step | Purpose |
|------|---------|
| **Connect** | SMTP settings, send delays, daily cap, OpenAI API key |
| **Import** | Upload leads, map columns, import batch |
| **Leads** | Review, search, and filter imported leads |
| **Campaign** | Create campaign — Overview (pitch, sign-off) + Sequences (email steps) |
| **Preview** | Merge or AI-generate subject and body per lead |
| **Queue** | Start, pause, resume, or stop the send queue |

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

## Repository layout

| Path | Role |
|------|------|
| `main.js` | Electron main process — IPC, SQLite, SMTP, AI, send queue |
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
