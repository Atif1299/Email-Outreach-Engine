<p align="center">
  <img src="./docs/readme-banner.svg" alt="Email Outreach" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-20232a?style=flat-square&logo=react&logoColor=61dafb" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

<p align="center">
  <strong>Import your leads. Map columns. Build sequences. Send through your SMTP — with pacing you control.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a>
  &nbsp;·&nbsp;
  <a href="#capabilities">Capabilities</a>
  &nbsp;·&nbsp;
  <a href="#production-build">Build</a>
  &nbsp;·&nbsp;
  <a href="#installing-on-windows">Install (Windows)</a>
  &nbsp;·&nbsp;
  <a href="#repository-layout">Layout</a>
  &nbsp;·&nbsp;
  <a href="#compliance-and-deliverability">Compliance</a>
</p>

---

## What is Email Outreach?

Email Outreach is a **desktop operator tool** for teams that already export contacts from LinkedIn or other sources as spreadsheets. You bring the file; the app handles **column mapping**, **merge-field templates**, **multi-step follow-ups** timed by hours after the previous send, and **SMTP delivery** through your own account so credentials stay under your control.

The workflow is intentionally linear: connect mail settings, import data, choose recipients for this run, save a campaign definition, then start a queue that respects **delay between messages** and a **daily cap**. Optional **OpenAI** integration can draft step bodies from your templates and lead fields when you enable it per step; preview remains available before anything sends.

Data lives on disk in **SQLite**. SMTP passwords and API keys use Electron **`safeStorage`** where the operating system provides keychain-backed encryption.

## Capabilities

- **Import** — `.csv`, `.xlsx`, `.xls` with preview and mapping; rows without a valid email are skipped.
- **Leads** — Search, review, and select who receives the current run.
- **Campaigns** — First touch plus follow-ups; Handlebars-style placeholders (`{{first_name}}`, `{{pitch_block}}`, `{{previous_subject}}`, etc.).
- **Optional AI** — OpenAI-backed generation per campaign step when configured.
- **Sending** — Nodemailer over SMTP; configurable inter-send delay and daily maximum sends.

## Requirements

- **Node.js** 18+ (LTS recommended).
- Development supported on **Windows, macOS, Linux**. The bundled `electron-builder` configuration targets **Windows NSIS** by default; adjust for other installers if needed.

## Quick start

```bash
git clone <your-repository-url>
cd "Email Automations Engine"
npm install
npm run dev
```

Configure SMTP (and optionally OpenAI) in the first wizard step before sending.

## Production build

```bash
npm run build
```

Outputs bundles and runs **electron-builder**. Artifacts appear under `release/<version>/` (see `electron-builder.json`).

On Windows, the installer is:

```text
release/<version>/Email Outreach_<version>.exe
```

Before building, close any running dev or packaged instance of the app (avoids a locked `better-sqlite3` native module during rebuild).

```bash
npm run build:win
```

## Installing on Windows

For teammates who only need to run the app (no Node.js required):

1. Copy **`Email Outreach_1.0.0.exe`** from `release/1.0.0/` (or your build version).
2. Run the installer and follow the wizard. You can change the install folder; the default per-user location is fine.
3. Launch **Email Outreach** from the Start Menu.

**Windows SmartScreen:** The installer is not code-signed yet. If you see *“Windows protected your PC”*, click **More info → Run anyway**. This is normal for internal team builds.

**Where your data is stored** (separate from the install folder):

| File | Purpose |
|------|---------|
| `%APPDATA%\Email Outreach\outreach.db` | Leads, campaigns, send history, AI bodies |
| `%APPDATA%\Email Outreach\outreach-settings.json` | SMTP/OpenAI settings (secrets encrypted via Windows) |

Uninstalling the app from **Settings → Apps** removes the program but **keeps** the data above, so leads and campaigns are not lost accidentally. Delete that folder manually if you want a full reset.

If you previously used a dev build, data may have lived under `%APPDATA%\email-outreach\`; the installed app migrates that folder to `Email Outreach` on first launch.

## Repository layout

| Path | Role |
|------|------|
| `electron/main` | IPC, SQLite, import parsing, mail queue, optional OpenAI. |
| `electron/preload` | Context bridge exposing the `outreach` API to the UI. |
| `src` | React + TypeScript wizard UI. |
| `src/shared` | Shared types. |

## Compliance and deliverability

Outbound cold email must comply with **CAN-SPAM**, **GDPR** (for EU/UK contacts), and your mail provider’s policies. Templates support **`{{unsubscribe_note}}`** for opt-out wording; **lawful basis, list sourcing, and message content remain your responsibility.**

## License

MIT. Originally scaffolded from **electron-vite-react**; product behavior and docs describe this application.
