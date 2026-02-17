# CLAUDE.md

## Project Overview

**Job Search Co-Pilot** (v1.2.0) is an AI-powered job search triage tool built as a Google Apps Script add-on. It integrates with Google Sheets and Gmail to automatically scan job-related emails, classify them using the Groq LLM API (llama-3.3-70b-versatile), and render an actionable dashboard in Google Sheets with suggested next steps.

The codebase is a **hybrid monolith**: a single `Code.js` runs identically in Google Apps Script (production) and Node.js (local development via mocks).

## Architecture

```
Google Sheets Dashboard (user-facing)
        │
Google Apps Script Runtime
  ├── Code.js (core logic: sync, classify, render)
  ├── Setup.html (web UI for initial configuration)
  │
  ├── Gmail API (read-only: scan sent threads)
  ├── Groq LLM API (classify emails, generate drafts)
  └── Script Properties (API key storage)
```

**Local dev mirror** (`local/`): Fastify server on port 3000 with mocked Google APIs, allowing iteration without real API calls.

## File Structure

```
Code.js              # Main application (all core logic, ~610 lines)
Setup.html           # Setup modal UI (dark mode, progressive flow)
tests.js             # Unit & integration tests (~890 lines)
tests_ui.js          # UI-specific tests (~160 lines)
appsscript.json      # Apps Script manifest (OAuth scopes, timezone)
.clasp.json          # Clasp CLI config (Apps Script project ID)
.claspignore         # Files excluded from Apps Script deployment
deploy.sh            # Interactive deploy (git + clasp push)
sync.sh              # Fast sync (git push + clasp push)
package.json         # Node dependencies & npm scripts
local/
  server.js          # Fastify dev server (serves Setup.html + API shim)
  mocks.js           # Google Apps Script API mocks
  test-runner.js     # CLI test runner with diagnostics
  data/
    mock_threads.json      # Mock Gmail threads
    mock_ai_responses.json # Mock Groq API responses
    sheets.json            # Mock spreadsheet data
```

## Code.js Module Organization

The entire application lives in `Code.js`, organized as module-like constant objects:

| Module | Purpose |
|--------|---------|
| `PROMPTS` | AI prompt templates for email classification |
| `USER_CONFIG` | User-tunable settings (lookback count, followup threshold, log level) |
| `CORE` | Frozen constants (sheet names, column headers, UI colors, rate limits) |
| `LOG` | Event logging system (writes to hidden `_log` sheet) |
| `TELEMETRY` | Anonymous usage tracking (MD5-hashed spreadsheet ID) |
| `App` | Adapter layer abstracting Gmail, Sheets, Properties, UrlFetch |
| `Security` | PII stripping, formula injection prevention, AI response validation |
| `Email` | Email thread parsing (domain, company, days since last message) |
| `Cache` | Thread classification cache (avoids redundant LLM calls, stored in `_cache` sheet) |
| `Status` | Status computation: Reply Needed / Follow Up / Waiting |
| `AI` | Groq LLM integration + fallback classification |

Top-level functions: `renderTable()`, `renderStyle()`, `createDailyTrigger()`, `removeTriggers()`, `sync()`, `saveAndInit()`, `onOpen()`, `doGet()`, `showSetup()`, `viewLogs()`, `debugSystem()`.

## Tech Stack

- **Language**: JavaScript (Google Apps Script dialect + Node.js for local dev)
- **Production Runtime**: Google Apps Script V8
- **Local Dev Server**: Fastify 4.26.0 on Node.js 18+
- **AI Provider**: Groq API (`llama-3.3-70b-versatile`)
- **Testing**: Jest 29.7.0 + custom CLI test runner
- **Deployment**: clasp (Google Apps Script CLI)
- **Type Definitions**: @types/google-apps-script 2.0.8

## Commands

### Development
```bash
npm run dev          # Start Fastify dev server at http://localhost:3000
```

### Testing
```bash
npm test             # Run Jest tests (uses --experimental-vm-modules)
npm run test:watch   # Jest watch mode
node local/test-runner.js                  # CLI test runner
node local/test-runner.js --filter Security  # Filter by test name
node local/test-runner.js --verbose          # Verbose output
node local/test-runner.js --diagnose         # System diagnostics only
```

### Deployment
```bash
npm run deploy       # Run sync.sh (git push + clasp push)
npm run push         # clasp push to Apps Script only
npm run pull         # clasp pull from Apps Script
npm run open         # Open Apps Script project in browser
```

## Code Conventions

### Naming
- **Constants/modules**: `SCREAMING_SNAKE_CASE` (`PROMPTS`, `USER_CONFIG`, `CORE`)
- **Module objects**: PascalCase (`App`, `Security`, `Email`, `Cache`, `Status`, `AI`)
- **Functions**: camelCase (`sync`, `parseEmail`, `renderTable`)
- **Private methods**: Underscore prefix (`_getSheet`, `_send`, `_email`)
- **Booleans**: `is`/`has` prefix (`isJob`, `isDirty`, `fromMe`)

### Formatting
- 2-space indentation
- Semicolons required
- Single quotes for strings, backticks for template literals
- Module sections separated by `═══` comment dividers

### Patterns
- **Adapter pattern**: `App` object abstracts all Google APIs, enabling mock injection for testing
- **Arrange-Act-Assert** in tests with `assert(condition, 'message')` style
- **Fallback strategy**: AI failures fall back to `{ category: 'JOB', play: 'Manual review needed' }`
- **Security-first**: All user-facing strings pass through `Security.sanitize()` (formula injection) and `Security.stripPII()` (email/phone redaction)

### Google Sheets Data Model
- **Dashboard** sheet: `Done | Status | Company | The Play | Draft | Days | Contact | Subject | Type`
- **_cache** sheet (hidden): `id | messageCount | category | isJob | play | draft | updatedAt`
- **_log** sheet (hidden): `Time | Level | Stage | Message` (max 200 rows)

## Key Design Decisions

1. **Single-file architecture**: All production code lives in `Code.js` because Google Apps Script deploys all `.js` files as a flat namespace. Module-like organization uses const objects instead of imports.

2. **Dual-environment execution**: The same `Code.js` is `eval()`'d in Node.js with mocked globals (`GmailApp`, `SpreadsheetApp`, etc.) for local development and testing.

3. **Cache-first approach**: Thread classifications are cached in a hidden `_cache` sheet. Only threads with new messages (`isDirty`) trigger LLM calls, reducing API usage.

4. **No `.env` file**: Configuration is stored in Google Script Properties (API key) and hardcoded in `USER_CONFIG` (tunable settings). Local dev uses mock data files.

5. **`.claspignore` controls deployment boundary**: Only `Code.js`, `Setup.html`, and `appsscript.json` are pushed to Apps Script. Tests, local dev files, and node_modules are excluded.

## Testing Approach

Tests use a `MockApp` adapter that mirrors the `App` adapter structure with in-memory implementations. No real API calls are made. Coverage includes:

- Email parsing (domain extraction, company name derivation)
- Security (PII stripping, formula injection prevention)
- Status computation (Reply Needed vs Follow Up vs Waiting logic)
- Cache hit/miss behavior
- AI fallback classification
- Render data transformation
- UI setup flow and menu creation (`tests_ui.js`)

## Common Modification Patterns

**Adding a new column to the Dashboard**: Update `CORE.HEADERS`, `CORE.WIDTHS`, the `data` mapping in `renderTable()`, and the column count constant (`colCount`).

**Changing AI behavior**: Modify `PROMPTS.classify` for prompt changes, or `AI.classifyAndPlay()` for API integration changes. Update `AI.fallback()` for fallback behavior.

**Adding a new Google API scope**: Update `appsscript.json` `oauthScopes` array.

**Adjusting triage thresholds**: Modify `USER_CONFIG` values (`LOOKBACK`, `FOLLOWUP_DAYS`, `IGNORE_DOMAINS`, etc.).
