# CLAUDE.md

## Project Overview

**Job Search Co-Pilot** (v1.2.0) is an AI-powered job search triage tool built as a Google Apps Script add-on. It integrates with Google Sheets and Gmail to automatically scan job-related emails, classify them using the Groq LLM API (llama-3.3-70b-versatile), and render an actionable dashboard in Google Sheets with suggested next steps.

All production code lives in a single `Code.js` file, deployed directly to Google Apps Script via clasp.

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

## File Structure

```
Code.js              # Main application (all core logic, ~770 lines)
Setup.html           # Setup modal UI (dark mode, progressive flow)
appsscript.json      # Apps Script manifest (OAuth scopes, timezone)
.clasp.json          # Clasp CLI config (Apps Script project ID)
.claspignore         # Files excluded from Apps Script deployment
deploy.sh            # Deploy script (git commit/push + clasp push)
jest.config.js       # Jest configuration
package.json         # Node dependencies & npm scripts
tests/
  unit.test.js       # Unit tests (pure logic, no Google API deps)
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

Top-level functions: `renderTable()`, `renderStyle()`, `createDailyTrigger()`, `removeTriggers()`, `sync()`, `saveAndInit()`, `onOpen()`, `doGet()`, `showSetup()`, `viewLogs()`, `debugSystem()`, `clearCache()`, `showDebugSheets()`, `hideDebugSheets()`.

## Tech Stack

- **Language**: JavaScript (Google Apps Script dialect)
- **Production Runtime**: Google Apps Script V8
- **AI Provider**: Groq API (`llama-3.3-70b-versatile`)
- **Testing**: Jest 29.7.0
- **Deployment**: clasp (Google Apps Script CLI)

## Commands

### Testing
```bash
npm test             # Run Jest unit tests
npm run test:watch   # Jest watch mode
```

### Deployment
```bash
npm run deploy       # Run deploy.sh (git commit/push + clasp push)
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
- **Fallback strategy**: AI failures fall back to `{ category: 'JOB', play: 'Manual review needed' }`
- **Security-first**: All user-facing strings pass through `Security.sanitize()` (formula injection) and `Security.stripPII()` (email/phone redaction)

### Google Sheets Data Model
- **Dashboard** sheet: `Done | Status | Company | The Play | Draft | Days | Contact | Subject | Type`
- **_cache** sheet (hidden): `id | messageCount | category | isJob | play | draft | updatedAt`
- **_log** sheet (hidden): `Time | Level | Stage | Message` (max 200 rows)

## Key Design Decisions

1. **Single-file architecture**: All production code lives in `Code.js` because Google Apps Script deploys all `.js` files as a flat namespace. Module-like organization uses const objects instead of imports.

2. **Cache-first approach**: Thread classifications are cached in a hidden `_cache` sheet. Only threads with new messages (`isDirty`) trigger LLM calls, reducing API usage.

3. **No `.env` file**: Configuration is stored in Google Script Properties (API key) and hardcoded in `USER_CONFIG` (tunable settings).

4. **`.claspignore` controls deployment boundary**: Only `Code.js`, `Setup.html`, and `appsscript.json` are pushed to Apps Script. Tests, deploy scripts, and node_modules are excluded.

## Testing Approach

Tests in `tests/unit.test.js` copy pure-logic modules from `Code.js` (Security, Status, AI fallback) and test them in isolation with Jest. No Google API dependencies or mocks are needed. Coverage includes:

- Status computation (Reply Needed vs Follow Up vs Waiting logic)
- Security (PII stripping, formula injection prevention)
- AI fallback classification
- AI response JSON parsing and extraction
- HTTP status code handling

## Common Modification Patterns

**Adding a new column to the Dashboard**: Update `CORE.HEADERS`, `CORE.WIDTHS`, the `data` mapping in `renderTable()`, and the column count constant (`colCount`).

**Changing AI behavior**: Modify `PROMPTS.classify` for prompt changes, or `AI.classifyAndPlay()` for API integration changes. Update `AI.fallback()` for fallback behavior.

**Adding a new Google API scope**: Update `appsscript.json` `oauthScopes` array.

**Adjusting triage thresholds**: Modify `USER_CONFIG` values (`LOOKBACK`, `FOLLOWUP_DAYS`, `IGNORE_DOMAINS`, etc.).
