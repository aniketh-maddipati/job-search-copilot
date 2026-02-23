# Architecture

Technical overview. For the full story, see [I Built This Because Job Searching Broke Me](https://medium.com/@anikethmaddipati/i-built-this-because-job-searching-broke-me-and-maybe-itll-help-you-too-74ca73305da8).

---

## Overview

```
User's Google Account
├── Gmail (sent folder) ──▶ Apps Script ──▶ Google Sheet
└── Triggers (6am sync, 7am digest)
                              │
                              ▼
                         LLM APIs (Groq → Gemini)
```

No external servers. No database. User owns their data.

---

## Trust Model

- **Data stays in user's account.** No external storage.
- **AI sees metadata only.** Subject, recipient, days since last message. Not email bodies.
- **No send permissions.** Cannot send email on user's behalf.
- **Open source.** Read every line.

---

## Core Design

### Two-Phase Classification

50 threads × 500ms = too slow.

Rules filter 80%. LLM handles the rest.

```javascript
if (subject.match(/interview|recruiter|role/i)) return { isJob: true };
if (domain === 'amazon.com' && subject.match(/order/i)) return { isJob: false };
return { uncertain: true };  // → LLM
```

### Caching

Cache by thread ID + message count. Re-classify only on new messages.

### Provider Failover

Groq primary. Gemini backup. Automatic switch on rate limit.

---

## Performance

| Operation | Time |
|-----------|------|
| Initial setup | ~30s |
| Daily sync (cached) | ~3s |

---

## Limitations

- Thread links don't work (Gmail ID mismatch)
- Apps Script: 6-min limit, slow cold starts
- Emoji breaks in email subjects

---


## Deep Dive

[The Architecture of a Zero-Infrastructure AI App](https://medium.com/@anikethmaddipati/the-architecture-of-a-zero-infrastructure-ai-app-12e7d5ffab96)

---

## Status

Code is available to use and learn from.

I'm job searching — can't commit to a full contribution model right now. Feedback welcome, updates when I can.