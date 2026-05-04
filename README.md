```text
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                                                                           ┃
┃   Email Outreach                                                          ┃
┃   Desktop application for lead import, templated campaigns, and SMTP.     ┃
┃                                                                           ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

**Email Outreach** is an Electron desktop app for operators who import lead lists (CSV or Excel), map columns, compose multi-step email sequences with merge fields, and send through their own SMTP account (for example Gmail with an app password). The interface is a linear wizard: connect mail settings, import data, select recipients, save a campaign, then run a rate-limited queue.

---

## Capabilities

- **Import** — Parse `.csv`, `.xlsx`, or `.xls`; map file columns to lead fields; rows without a valid email address are not stored.
- **Leads** — Search, review, and select which contacts receive the current run.
- **Campaigns** — One or more steps (first message and follow-ups) with per-step delay after the previous send. Handlebars-style placeholders (for example `{{first_name}}`, `{{current_employer}}`, `{{pitch_block}}`, and follow-up context such as `{{previous_subject}}`).
- **Optional AI** — If you configure an OpenAI API key, individual steps can generate message body text from your templates and lead data; you can still preview before sending.
- **Sending** — Nodemailer over SMTP, configurable delay between messages and a daily cap. Secrets for SMTP and API keys are stored with Electron `safeStorage` where the OS supports it.
- **Persistence** — SQLite (`better-sqlite3`) for leads, campaigns, send history, and queue state.

## Requirements

- **Node.js** 18 or newer (LTS recommended).
- **Windows, macOS, or Linux** for development; this repository’s build configuration targets Windows NSIS by default. Adjust `electron-builder` if you ship for other platforms.

## Quick start

```bash
git clone <your-repo-url>
cd "Email Automations Engine"
npm install
npm run dev
```

The Vite dev server runs together with the Electron shell. Set SMTP and optional API keys in the first wizard step before attempting to send.

## Production build

```bash
npm run build
```

Produces renderer and main-process bundles, then runs `electron-builder`. Installers and unpacked artifacts are written under `release/<version>/` (see `electron-builder.json`).

## Repository layout

| Path | Role |
|------|------|
| `electron/main` | Main process: IPC, SQLite, file import, mail queue, OpenAI calls. |
| `electron/preload` | Context-isolated bridge exposing a small `outreach` API to the UI. |
| `src` | React (TypeScript) renderer: wizard steps, forms, and status. |
| `src/shared` | Shared type definitions. |

## Compliance and deliverability

Cold email is subject to **CAN-SPAM**, **GDPR** (if you contact people in the EU/UK), and your provider’s anti-abuse rules. The app includes an `{{unsubscribe_note}}` merge field for opt-out language in templates; **legal basis, list provenance, and copy are your responsibility** as the sender.

## License

MIT. This project was initially scaffolded from the `electron-vite-react` template; application logic and documentation describe the Email Outreach product built on top.
