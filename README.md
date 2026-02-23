# Job Co-Pilot

An AI-powered job search tracker that lives in Google Sheets.

Scans your sent emails. Finds job threads. Tells you who to reply to.

---

## What You'll See

![Dashboard](screenshots/dashboard.png)
*Your job threads, sorted by who needs attention*

![Digest Email](screenshots/digest.png)
*Daily email at 7am with your top plays*

---

## The Problem

You're job searching. You have 40+ email threads open. Some recruiters replied and you forgot. Some you followed up on twice. Some are dead but you keep checking.

Spreadsheet trackers require manual entry. You stop updating them after 3 days.

## What This Does

- **Syncs automatically** — Pulls your last 50 sent emails daily at 6am
- **AI classification** — Figures out which are job-related
- **Shows what matters** — Who needs a reply, who to follow up with, who to let go
- **Daily digest** — 7am email with your top plays

---

## Get Started (5 minutes)

### 1. Copy the template
[**→ Copy Template**](https://docs.google.com/spreadsheets/d/YOUR_TEMPLATE_ID/copy)

### 2. Get a free API key
- [Groq](https://console.groq.com/keys) (recommended) — 14,400 free requests/day
- [Gemini](https://aistudio.google.com/app/apikey) (backup) — 1,500 free requests/day

### 3. Run setup
Open the sheet → **📧 Job Co-Pilot → Setup** → Paste API key → Initialize

---

## Status Guide

| Status | Meaning |
|--------|---------|
| 🔴 Reply Needed | They replied. Your turn. |
| 🟠 Follow Up | You sent last. 5+ days. Nudge them. |
| 🔵 Waiting | You sent recently. Give it time. |

---

## Privacy

Your data stays yours.

- Runs entirely in your Google account
- AI only sees thread metadata (subject, contact, days)
- No external servers, no data collection
- Open source — read every line

---

## Known Limitations

- **Thread links in digest don't work** — Gmail uses a different ID format. Use "Open Dashboard" instead.
- **Emails show as "from me"** — Apps Script sends from your account. Create a Gmail filter for "Job Co-Pilot."
- **AI isn't perfect** — Some threads get miscategorized. Use "Sync (Fresh)" to re-classify.

---

## Architecture

```
User's Google Account
├── Gmail (sent folder)
│   └── Apps Script reads last 50 threads
├── Google Sheet (dashboard)
│   └── Stores classified threads + plays
└── Apps Script (runtime)
    ├── Daily sync trigger (6am)
    ├── Digest email trigger (7am)
    └── LLM calls (Groq → Gemini failover)
```

**Key decisions:**

1. **Two-phase filtering** — Rules catch 80% of emails (free, instant). LLM only for ambiguous ones.
2. **Cache by message count** — Skip re-classification if thread hasn't changed.
3. **Provider failover** — Groq rate-limited? Auto-switch to Gemini.

See [Architecture Deep Dive](LINK_TO_MEDIUM) for full details.

---

## For Developers

```bash
git clone https://github.com/aniketh-maddipati/job-search-copilot.git
cd job-search-copilot
npm install
npm test
./deploy.sh -m "my changes"
```

PRs welcome.

---

## Why I Built This

I was mass cold emailing during my job search and losing track of who replied, who ghosted, and who I forgot to follow up with.

Built this for myself. Figured others might find it useful.

---

## Author

**Aniketh Maddipati** — Builder, NYC

[LinkedIn](https://linkedin.com/in/anikethmaddipati) · [GitHub](https://github.com/aniketh-maddipati)

---

MIT License