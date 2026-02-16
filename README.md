# Job Search Co-Pilot

**AI-powered job triage in Google Sheets.** Inbox chaos → one sheet, clear next actions.

## Local Development

## Why

### Architecture

## How it works

1. **Gmail** — Scans your inbox for job/recruiter/application threads.
2. **AI** — Groq-powered triage: category (job vs networking), suggested next play, reply drafts.
3. **Sheet** — One dashboard: threads, status, actions. You run the play; the tool doesn’t send mail.

Your data stays in your Google account and in the Sheet. No third-party CRM, no lock-in.

## Why trust it

- **Open source** — Full code in this repo. Inspect, fork, change.
- **Runs where you already work** — Google Sheets + Gmail. No new platform.
- **You stay in control** — AI suggests; you decide what to send. No auto-sending.
- **Local dev & tests** — Same logic runs in Node with mocks; test without hitting Gmail or APIs.

---

## Setup (5 steps)

1. **Prereqs** — Node 18+, a Google account, [clasp](https://github.com/google/clasp) (`npm i -g clasp`).

2. **Clone & install**
   ```bash
   git clone <this-repo-url> && cd job-search-copilot
   npm install
   ```

3. **Connect Apps Script**
   ```bash
   clasp login
   clasp create --type sheets --title "Job Search Co-Pilot"   # or clasp clone <existing-id>
   ```

4. **Configure** — Deploy once, open the Sheet, run the Co-Pilot setup from the menu. Add your Groq API key in Script Properties when prompted.

5. **Deploy**
   ```bash
   npm run deploy
   ```
   Then open the Sheet from the Apps Script project and use the add-on menu.

---

## Local development

Same `Code.js` runs in Apps Script (production) and in Node (local) via mocks. No Gmail/API calls needed to iterate.

```bash
npm run dev    # UI + mock backend at http://localhost:3000
npm test       # Unit tests
```

**Layout:** `Code.js` = core logic. `local/server.js` = local dev server; `local/mocks.js` = Gmail/Sheets/UrlFetch mocks; `local/data/*.json` = mock threads and AI responses. See [`local/`](local/) for details.

---

## Project layout

| Path | Role |
|------|------|
| `Code.js` | Main Apps Script + triage logic |
| `Setup.html` | Web UI for setup |
| `local/server.js` | Local dev server |
| `local/mocks.js` | Mock Gmail, Sheets, etc. |
| `appsscript.json` | Apps Script manifest |
| `sync.sh` / `npm run deploy` | Deploy to Apps Script |

---

## Community

- **Use it** — Star the repo if it helps you.
- **Improve it** — Open issues for bugs/ideas; PRs welcome.
- **Share it** — Built something on top? Link back so others can find it.

**License:** MIT.
