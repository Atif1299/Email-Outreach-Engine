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
