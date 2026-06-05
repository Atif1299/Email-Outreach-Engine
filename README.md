# Email Outreach

Desktop app for importing leads, building email campaigns, personalizing messages with merge tags or AI, and sending them through your own SMTP server.

Built with Electron and vanilla JavaScript. Data is stored locally on your machine.

## Features

- **SMTP setup** — Gmail and other providers, with connection test
- **Lead import** — CSV, XLSX, and XLS with column mapping
- **Lead management** — Search, filter by batch, bulk select/delete
- **Campaigns** — Pitch block, sender sign-off, target batch, multi-step sequences
- **AI personalization** — OpenAI-generated subject and body per lead (optional)
- **Preview** — Merge preview, per-lead AI generation, bulk AI, saved overrides
- **Send queue** — Rate limits, daily cap, pause/resume/stop

## Requirements

- Node.js 18+
- npm
- Windows, macOS, or Linux

For Gmail SMTP, use an [App Password](https://support.google.com/accounts/answer/185833) with 2-Step Verification enabled.

## Install

```bash
cd email-outreach-v2
npm install
npm run rebuild
```

`npm run rebuild` rebuilds `better-sqlite3` for your Electron version. Run it again after upgrading Electron or Node.

## Run

```bash
npm start
```

## Workflow

1. **Connect** — SMTP settings, send delays, daily cap, optional OpenAI API key
2. **Import** — Upload leads, map columns, import batch
3. **Leads** — Review and filter imported leads
4. **Campaign** — Create campaign (Overview + Sequences tabs), save
5. **Preview** — Generate or merge email content per lead
6. **Queue** — Start sending for the selected campaign

## Data storage

App data is stored in Electron `userData`:

| OS | Path |
|----|------|
| Windows | `%APPDATA%\Email Outreach\` |
| macOS | `~/Library/Application Support/Email Outreach/` |
| Linux | `~/.config/Email Outreach/` |

Files:

- `outreach.db` — leads, campaigns, sends, overrides
- `settings.json` — SMTP/OpenAI settings (passwords encrypted via OS keychain when available)

## Configuration

### SMTP

| Field | Example |
|-------|---------|
| Host | `smtp.gmail.com` |
| Port | `465` (TLS) |
| Username | Full email address |
| Password | App password (Gmail) |
| From Name / From Email | What recipients see |

### OpenAI (optional)

Set your API key in **Connect**. Used when a sequence step has **AI** enabled or when you click **Generate AI** on the Preview page.

### Merge tags

```
{{first_name}} {{last_name}} {{email}}
{{current_employer}} {{current_title}}
{{pitch_block}} {{sender_info}}
```

## Project structure

```
email-outreach-v2/
├── main.js        # Electron main process, DB, SMTP, AI, queue
├── preload.js     # IPC bridge
├── renderer.js    # UI logic
├── index.html     # App layout
├── styles.css     # Styles
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Launch the app |
| `npm run rebuild` | Rebuild native modules for Electron |

## Troubleshooting

**`better-sqlite3` errors after install**

```bash
npm run rebuild
```

**Gmail authentication failed**

- Use an App Password, not your normal Google password
- Set SMTP username to your full Gmail address

**Database corrupt (`SQLITE_CORRUPT`)**

Close the app and delete:

- `outreach.db`
- `outreach.db-wal`
- `outreach.db-shm`

from the `userData` folder above. The app will create a fresh database on next launch.

## License

MIT
