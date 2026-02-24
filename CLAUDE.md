# CLAUDE.md

## Project Overview

**Job Search Co-Pilot** (v1.2.1) is an AI-powered job search triage tool built as a Google Apps Script add-on. It integrates with Google Sheets and Gmail to automatically scan job-related emails, classify them using the Groq LLM API (llama-3.3-70b-versatile), and render an actionable dashboard in Google Sheets with suggested next steps.

The codebase is a **hybrid monolith**: a single `Code.js` runs identically in Google Apps Script (production) and Node.js (local development via mocks).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Google Sheet                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Dashboard   │  │   _cache     │  │    _log      │          │
│  │  (user-facing)│  │  (hidden)    │  │   (hidden)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Code.gs (Main)                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │ Filters │→ │  Cache  │→ │   AI    │→ │ Render  │            │
│  │ (rules) │  │ (store) │  │ (LLM)   │  │ (sheet) │            │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘            │
└─────────────────────────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
┌──────────────┐          ┌──────────────┐
│    Gmail     │          │  Groq/Gemini │
│   (emails)   │          │    (LLM)     │
└──────────────┘          └──────────────┘
        │
        ▼
┌──────────────┐
│  Telemetry   │
│  (analytics) │
└──────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `Code.gs` | Main application logic |
| `Setup.html` | Onboarding UI sidebar |
| `DigestEmail.html` | Daily digest email template |
| `WelcomeEmail.html` | Post-setup welcome email |

---

## Core Concepts

### Sync Flow
1. **Fetch** — Get 50 most recent sent emails from Gmail
2. **Filter** — Rules-based exclusion (transactional, personal domains)
3. **Pre-filter** — LLM classifies uncertain threads as job-related or not
4. **Classify** — LLM generates "play" (action) and "draft" (reply) for job threads
5. **Cache** — Store results to avoid re-processing
6. **Render** — Display in Dashboard sheet

### Status Logic
- **Reply Needed** — They replied, you haven't
- **Follow Up** — You replied 5+ days ago, no response
- **Waiting** — You replied <5 days ago

### Telemetry (v1.2.1)
Tracks anonymous usage metrics:
- `threads` — Total threads scanned per sync
- `newThreads` — First-time threads (not previously cached)
- `reply`, `follow`, `wait` — Status counts
- `runtime` — Sync duration in ms
- `hasGroq`, `hasGemini` — API key choice
- `hasLinkedIn`, `hasResume` — Context provided
- `digestOptIn`, `autoSyncOptIn` — Feature adoption

---

## Development Commands

```javascript
// Manual sync
sync()

// Fresh sync (clears cache)
syncFresh()

// Send digest email now
sendDailyDigest()

// Run integration tests
runIntegrationTests()

// Show hidden debug sheets
showDebugSheets()

// Clear all stored properties
clearAllProperties()
```

---

## Version History

### v1.2.1 (Current)
- Fixed telemetry accuracy — track unique threads vs cumulative
- Added `newThreads` metric to distinguish first-time scans
- Added feature adoption tracking (API choice, context, opt-ins)
- Improved dashboard formulas for honest metrics

### v1.2.0
- Two-stage filtering (rules → LLM pre-filter → LLM classify)
- Cache versioning
- Daily digest emails
- Welcome email on setup

### v1.1.0
- Basic sync and classify
- Single LLM provider support

---

## Common Tasks

### Adding a new telemetry field
1. Add to `stats` object in `sync()`
2. Add to `payload` in `TELEMETRY.send()`
3. Add to `doPost()` in telemetry receiver
4. Add to `updateEventsHeaders()`
5. Add dashboard formula

### Changing LLM provider
1. Add provider to `Providers` object
2. Update `AI.selectProvider()` and `AI.getNextProvider()`
3. Add key handling in `saveAndInit()`

### Modifying email templates
- Edit `DigestEmail.html` or `WelcomeEmail.html`
- Use `<?= variable ?>` for template variables
- Test with `sendDailyDigest()` or `sendWelcomeEmail()`

---

## Gotchas

1. **Gmail rate limits** — Don't call `GmailApp.search()` too frequently
2. **Apps Script 6-min timeout** — Sync must complete within this
3. **Cache versioning** — Bump `CORE.CACHE_VERSION` when schema changes
4. **Telemetry deployment** — Must redeploy web app for `doPost` changes

---

## Testing

```javascript
// Run all tests
runIntegrationTests()

// Expected output:
// ✅ Cache.load()
// ✅ Gmail search (X threads)
// ✅ API key configured
// ✅ Dashboard exists
// ✅ Session email (xxx...)
// ✅ LLM responds
```