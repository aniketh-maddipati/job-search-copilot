/**
 * 📧 Job Search Co-Pilot v1.2.0
 * AI-powered job search triage in Google Sheets
 *
 * @author Aniketh Maddipati
 * @license MIT
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

const PROMPTS = {
  preFilter: `Classify which emails are JOB SEARCH related.

JOB SEARCH includes:
- Recruiter outreach, interview scheduling, application follow-ups
- Networking for job opportunities (intros, coffee chats, referral requests)
- Company conversations about roles, hiring, or opportunities

NOT JOB SEARCH:
- Personal emails, receipts, newsletters, appointments
- Professional but not job-seeking (existing work, clients, friends)

Emails:
\${emails}

Return JSON array of indices that ARE job search related.
Example: [0, 2, 5]
Only the array, nothing else.`,

  classify: `You are a job search strategist. For each thread, provide actionable next steps.

CANDIDATE CONTEXT:
\${candidateContext}

RULES:
1. "play" = ONE specific action sentence. Be specific, not generic.
2. "draft" = Ready-to-send reply, 2-3 sentences max. Address recipient by name. Match candidate's tone.
3. If status is "Waiting" (sent <5 days ago): play = "Wait for reply", draft = ""
4. If status is "Reply Needed" (they replied): Address what they said or asked.
5. If status is "Follow Up" (5+ days, no reply): Add a hook—new achievement, relevant news, or specific question. Never just "following up" or "checking in".

THREADS:
\${threads}

Return JSON array only:
[{"category": "JOB|NETWORKING|OTHER", "isJob": true|false, "play": "...", "draft": "..."}]`,

  digestObservation: `You're a sharp career coach. Given these stats, write ONE punchy observation (under 15 words). Specific, not generic.

Stats: \${stats}

Return only the sentence.`
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const USER_CONFIG = {
  LOOKBACK: 50,
  FOLLOWUP_DAYS: 5,
  MAX_CLASSIFY: 30,
  FINAL_CATEGORIES: ['Offer', 'Final Round', 'Contract'],
};

const CORE = Object.freeze({
  VERSION: '1.2.0',
  CACHE_VERSION: 2,
  SHEETS: { MAIN: 'Dashboard', CACHE: '_cache', LOG: '_log' },
  CACHE_COLS: ['id', 'isJobThread', 'filterSource', 'messageCount', 'category', 'isJob', 'play', 'draft', 'firstSeen'],
  HEADERS: ['Done', 'Status', 'Company', 'The Play', 'Draft', 'Days', 'Contact', 'Subject', 'Type'],
  WIDTHS: [50, 110, 100, 280, 320, 50, 85, 200, 70],
  UI: {
    ROW_HEIGHT: 50,
    FONT: 'Google Sans, Roboto, Arial',
    COLORS: {
      headerBg: '#1a1a1a',
      headerFg: '#ffffff',
      replyNeeded: { bg: '#fce8e6', fg: '#c5221f' },
      followUp: { bg: '#fef7e0', fg: '#e37400' },
      waiting: { bg: '#e8f0fe', fg: '#1967d2' },
      playFg: '#1a73e8',
    },
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGER (Developer-focused, hidden from users)
// ═══════════════════════════════════════════════════════════════════════════════

const LOG = {
  MAX_ROWS: 200,
  _sheet: null,

  _getSheet() {
    if (this._sheet) return this._sheet;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(CORE.SHEETS.LOG);
    if (!sheet) {
      sheet = ss.insertSheet(CORE.SHEETS.LOG);
      sheet.getRange(1, 1, 1, 4).setValues([['Time', 'Level', 'Stage', 'Message']]);
      sheet.setColumnWidths(1, 4, [80, 50, 100, 500]);
      sheet.hideSheet();
    }
    this._sheet = sheet;
    return sheet;
  },

  _write(level, stage, msg) {
    try {
      const sheet = this._getSheet();
      const time = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss');
      sheet.appendRow([time, level, stage, msg]);
      if (sheet.getLastRow() > this.MAX_ROWS) {
        sheet.deleteRows(2, sheet.getLastRow() - this.MAX_ROWS);
      }
    } catch (e) { /* fail silently */ }
  },

  info(stage, msg) { this._write('INFO', stage, msg); console.log(`[${stage}] ${msg}`); },
  warn(stage, msg) { this._write('WARN', stage, msg); console.warn(`[${stage}] ${msg}`); },
  error(stage, msg) { this._write('ERROR', stage, msg); console.error(`[${stage}] ${msg}`); },

  summary(stats) {
    const line = `${stats.total} threads → ${stats.jobThreads} job (${stats.filterCacheHits} cached, ${stats.rulesIncluded} rules, ${stats.llmIncluded} llm) → ${stats.classifyCacheHits} cached, ${stats.dirty} classified → ${stats.replyNeeded} reply, ${stats.followUp} follow, ${stats.waiting} wait`;
    this._write('INFO', 'sync', line);
    console.log(`[sync] ${line}`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TELEMETRY
// ═══════════════════════════════════════════════════════════════════════════════

const TELEMETRY = {
  endpoint: 'https://script.google.com/macros/s/AKfycbyhWg0qfM-rYgudfMEMifA29jzgCl-gJsVzKU_KjrVTdP4u_9WUjsC9dc-B_wiKXuc4/exec',

  _uid() {
    const id = SpreadsheetApp.getActiveSpreadsheet().getId();
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, id + 'copilot');
    return hash.map(b => ((b + 128) % 256).toString(16).padStart(2, '0')).join('').slice(0, 12);
  },

  send(event, data) {
    try {
      UrlFetchApp.fetch(this.endpoint, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ ts: new Date().toISOString(), uid: this._uid(), v: CORE.VERSION, event, ...data }),
        muteHttpExceptions: true
      });
    } catch (e) { /* fail silently */ }
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════════

const App = {
  gmail: { search: (q, start, max) => GmailApp.search(q, start, max) },
  sheets: {
    getActive: () => SpreadsheetApp.getActiveSpreadsheet(),
    getSheet: (ss, name) => ss.getSheetByName(name),
    createSheet: (ss, name) => ss.insertSheet(name),
    getUi: () => { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } },
  },
  props: {
    get: (k) => PropertiesService.getScriptProperties().getProperty(k),
    set: (k, v) => PropertiesService.getScriptProperties().setProperty(k, v),
  },
  session: {
    _email: null,
    getEmail() {
      if (this._email) return this._email;
      try {
        const threads = GmailApp.search('in:sent', 0, 1);
        if (threads.length) {
          const from = threads[0].getMessages()[0].getFrom().toLowerCase();
          const match = from.match(/<(.+)>/) || [null, from];
          this._email = match[1] || from;
        }
      } catch (e) { /* fail silently */ }
      return this._email || '';
    },
  },
};

const Security = {
  stripPII: (s) => !s ? '' : s.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]').replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone]'),
  sanitize: (s) => {
    if (typeof s !== 'string' || !s.trim()) return '—';
    return /^[=+\-@]/.test(s.trim()) ? "'" + s : s;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT PARSER
// ═══════════════════════════════════════════════════════════════════════════════

const ContextParser = {
  clean(raw, type) {
    if (!raw || typeof raw !== 'string') return null;
    let text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/[^\x20-\x7E\n]/g, '').trim();
    if (text.length < 50 || text.length > 20000) return null;
    return type === 'linkedin' ? this._parseLinkedIn(text) : this._parseResume(text);
  },

  _parseLinkedIn(text) {
    [/Skip to main content/gi, /LinkedIn/gi, /Messaging/gi, /Notifications/gi, /\d+ connections/gi, /Contact info/gi]
      .forEach(re => { text = text.replace(re, ''); });
    const sections = {};
    const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 2);
    if (lines[0]) sections.name = lines[0].slice(0, 100);
    const expMatch = text.match(/Experience\s+(.{50,2000}?)(?=Education|Skills|$)/is);
    if (expMatch) sections.experience = expMatch[1].trim().slice(0, 1500);
    const eduMatch = text.match(/Education\s+(.{20,800}?)(?=Skills|Experience|$)/is);
    if (eduMatch) sections.education = eduMatch[1].trim().slice(0, 500);
    if (!sections.name && !sections.experience) return null;
    return Object.entries(sections).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n\n');
  },

  _parseResume(text) {
    const sections = {};
    const expMatch = text.match(/EXPERIENCE\s*(.{50,3000}?)(?=EDUCATION|SKILLS|$)/is);
    if (expMatch) sections.experience = expMatch[1].trim().slice(0, 2000);
    const eduMatch = text.match(/EDUCATION\s*(.{20,800}?)(?=SKILLS|PROJECTS|$)/is);
    if (eduMatch) sections.education = eduMatch[1].trim().slice(0, 500);
    if (!sections.experience && !sections.education) return null;
    return Object.entries(sections).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n\n');
  },

  score(parsed) {
    if (!parsed) return 0;
    let score = parsed.length > 200 ? 20 : 0;
    if (parsed.length > 500) score += 20;
    if (/EXPERIENCE:/i.test(parsed)) score += 25;
    if (/EDUCATION:/i.test(parsed)) score += 15;
    if (/NAME:/i.test(parsed)) score += 10;
    return Math.min(score, 100);
  },

  sanitizeForPrompt(text) {
    if (!text) return '';
    return text.replace(/```/g, '').replace(/\${/g, '').replace(/SYSTEM:|USER:|ASSISTANT:/gi, '').slice(0, 4000);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// FILTERS (Rules-based, zero cost)
// ═══════════════════════════════════════════════════════════════════════════════

const Filters = {
  PERSONAL_DOMAINS: ['gmail', 'hotmail', 'yahoo', 'outlook', 'icloud', 'protonmail', 'aol', 'msn', 'live'],

  TRANSACTIONAL: [
    /receipt/i, /order confirm/i, /shipping/i, /delivered/i, /tracking/i,
    /password/i, /verification/i, /verify your/i, /OTP/i,
    /appointment/i, /lab results/i, /invoice/i, /payment/i,
    /unsubscribe/i, /newsletter/i
  ],

  JOB_SIGNALS: [
    /interview/i, /role/i, /position/i, /opportunity/i, /application/i,
    /recruiter/i, /recruiting/i, /hiring/i, /candidate/i,
    /\bEM\b/, /\bSWE\b/, /engineer/i, /manager/i,
    /follow.?up/i, /intro\b/i, /coffee/i, /resume/i
  ],

  classify(p, myEmail) {
    // Hard excludes
    if (p.to.includes(myEmail)) return { action: 'exclude', reason: 'self_send' };
    if (this.PERSONAL_DOMAINS.includes(p.domain)) return { action: 'exclude', reason: 'personal_domain' };
    if (this.TRANSACTIONAL.some(re => re.test(p.subject))) return { action: 'exclude', reason: 'transactional' };

    // Hard includes
    if (this.JOB_SIGNALS.some(re => re.test(p.subject))) return { action: 'include', reason: 'job_signal' };

    // Uncertain
    return { action: 'uncertain', reason: 'needs_llm' };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE (Combined filter + classification)
// ═══════════════════════════════════════════════════════════════════════════════

const Cache = {
  _data: new Map(),

  load() {
    const sheet = App.sheets.getSheet(App.sheets.getActive(), CORE.SHEETS.CACHE);
    if (!sheet || sheet.getLastRow() <= 1) return this._data;

    const version = parseInt(sheet.getRange(1, 1).getNote()) || 0;
    if (version < CORE.CACHE_VERSION) {
      LOG.info('cache', `Version ${version} → ${CORE.CACHE_VERSION}, clearing`);
      sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), CORE.CACHE_COLS.length).clearContent();
      sheet.getRange(1, 1).setNote(String(CORE.CACHE_VERSION));
      return this._data;
    }

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CORE.CACHE_COLS.length).getValues();
    rows.forEach(r => r[0] && this._data.set(r[0], {
      isJobThread: r[1],
      filterSource: r[2],
      messageCount: r[3],
      category: r[4],
      isJob: r[5],
      play: r[6],
      draft: r[7],
      firstSeen: r[8]
    }));
    return this._data;
  },

  get(id) { return this._data.get(id); },

  set(id, data) { this._data.set(id, { ...this._data.get(id), ...data }); },

  save(rows) {
    const ss = App.sheets.getActive();
    let sheet = App.sheets.getSheet(ss, CORE.SHEETS.CACHE) || App.sheets.createSheet(ss, CORE.SHEETS.CACHE);

    // Also update from rows
    rows.forEach(r => this.set(r.id, {
      isJobThread: true,
      filterSource: r.filterSource || 'sync',
      messageCount: r.messageCount,
      category: r.category,
      isJob: r.isJob,
      play: r.play,
      draft: r.draft,
      firstSeen: r.firstSeen
    }));

    const data = Array.from(this._data.entries()).map(([id, c]) => [
      id, c.isJobThread, c.filterSource, c.messageCount, c.category, c.isJob, c.play, c.draft, c.firstSeen
    ]);

    sheet.clear().getRange(1, 1, 1, CORE.CACHE_COLS.length).setValues([CORE.CACHE_COLS]);
    sheet.getRange(1, 1).setNote(String(CORE.CACHE_VERSION));
    if (data.length) sheet.getRange(2, 1, data.length, CORE.CACHE_COLS.length).setValues(data);
    sheet.hideSheet();
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════════════════════

const Status = {
  compute(row) {
    if (!row.fromMe) return { label: 'Reply Needed', ...CORE.UI.COLORS.replyNeeded };
    if (row.days >= USER_CONFIG.FOLLOWUP_DAYS) return { label: 'Follow Up', ...CORE.UI.COLORS.followUp };
    return { label: 'Waiting', ...CORE.UI.COLORS.waiting };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL PARSER
// ═══════════════════════════════════════════════════════════════════════════════

const Email = {
  parseBasic(thread) {
    const id = thread.getId();
    const msgs = thread.getMessages();
    const to = msgs[0].getTo().toLowerCase().replace(/["']/g, '');
    const domain = (to.match(/@([\w.-]+)/) || [])[1]?.split('.')[0] || '';
    return { id, thread, to, domain, subject: msgs[0].getSubject() };
  },

  parseFull(thread, cached, myEmail) {
    const msgs = thread.getMessages();
    const last = msgs[msgs.length - 1];
    const id = thread.getId();
    const messageCount = msgs.length;
    const to = msgs[0].getTo().toLowerCase().replace(/["']/g, '');
    const fromMe = last.getFrom().toLowerCase().includes(myEmail);
    const days = Math.floor((Date.now() - last.getDate().getTime()) / 86400000);
    const domain = (to.match(/@([\w.-]+)/) || [])[1]?.split('.')[0] || '';

    return {
      id, messageCount,
      company: domain || 'Unknown',
      contact: to.split('@')[0],
      subject: msgs[0].getSubject(),
      days, fromMe,
      body: Security.stripPII(last.getPlainBody().slice(0, 300)),
      cached,
      isDirty: !cached || cached.messageCount !== messageCount,
      firstSeen: cached?.firstSeen || Date.now()
    };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDERS
// ═══════════════════════════════════════════════════════════════════════════════

const Providers = {
  groq: {
    call(prompt, key) {
      try {
        const resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'Authorization': `Bearer ${key}` },
          payload: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
          muteHttpExceptions: true
        });
        const code = resp.getResponseCode();
        if (code !== 200) return { success: false, reason: code === 401 ? 'auth' : code === 429 ? 'rate_limit' : 'http_' + code };
        const content = JSON.parse(resp.getContentText()).choices?.[0]?.message?.content;
        return content ? { success: true, content } : { success: false, reason: 'no_content' };
      } catch (e) {
        return { success: false, reason: 'network' };
      }
    }
  },
  gemini: {
    call(prompt, key) {
      try {
        const resp = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          muteHttpExceptions: true
        });
        const code = resp.getResponseCode();
        if (code !== 200) return { success: false, reason: code === 400 ? 'auth' : code === 429 ? 'rate_limit' : 'http_' + code };
        const content = JSON.parse(resp.getContentText()).candidates?.[0]?.content?.parts?.[0]?.text;
        return content ? { success: true, content } : { success: false, reason: 'no_content' };
      } catch (e) {
        return { success: false, reason: 'network' };
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// AI SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

const AI = {
  BATCH_SIZE: 10,

  getKeys() { return { groq: App.props.get('GROQ_KEY'), gemini: App.props.get('GEMINI_KEY') }; },

  selectProvider(keys) { return keys.groq ? 'groq' : keys.gemini ? 'gemini' : null; },

  getNextProvider(current, keys) {
    if (current === 'groq' && keys.gemini) return 'gemini';
    return null;
  },

  getCandidateContext() {
    const linkedin = App.props.get('USER_LINKEDIN') || '';
    const resume = App.props.get('USER_RESUME') || '';
    if (!linkedin && !resume) return 'No candidate profile provided.';
    let ctx = '';
    if (linkedin) ctx += `LINKEDIN:\n${linkedin}\n\n`;
    if (resume) ctx += `RESUME:\n${resume}`;
    return ContextParser.sanitizeForPrompt(ctx);
  },

  testKey(provider, key) {
    const resp = Providers[provider].call('Reply with: OK', key);
    return resp.success;
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // PRE-FILTER (cheap, subject-only)
  // ─────────────────────────────────────────────────────────────────────────────

  preFilter(candidates) {
    const keys = this.getKeys();
    let provider = this.selectProvider(keys);
    if (!provider) return null;

    const emails = candidates.map((c, i) => `${i}: @${c.domain} | ${c.subject.slice(0, 50)}`).join('\n');
    const prompt = PROMPTS.preFilter.replace('${emails}', emails);

    while (provider) {
      const resp = Providers[provider].call(prompt, keys[provider]);

      if (resp.success) {
        const match = resp.content.match(/\[[\d,\s]*\]/);
        if (match) {
          try {
            return JSON.parse(match[0]);
          } catch (e) {
            LOG.warn('ai:prefilter', `Parse failed: ${resp.content.slice(0, 50)}`);
          }
        }
      } else {
        LOG.warn(`ai:prefilter:${provider}`, resp.reason);
      }

      provider = this.getNextProvider(provider, keys);
      if (provider) LOG.info('ai:prefilter', `Failover to ${provider}`);
    }

    return null; // All providers failed
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // FULL CLASSIFICATION
  // ─────────────────────────────────────────────────────────────────────────────

  classifyBatch(rows) {
    const keys = this.getKeys();
    let provider = this.selectProvider(keys);
    if (!provider) {
      rows.forEach(r => this.fallback(r, 'no_key'));
      return 0;
    }

    const candidateContext = this.getCandidateContext();
    const threads = rows.map(r =>
      `Co: ${r.company} | Contact: ${r.contact} | Status: ${r.status.label} | Days: ${r.days} | Subject: ${r.subject} | Last: ${r.body}`
    ).join('\n---\n');

    const prompt = PROMPTS.classify
      .replace('${candidateContext}', candidateContext)
      .replace('${threads}', threads);

    while (provider) {
      const resp = Providers[provider].call(prompt, keys[provider]);

      if (resp.success) {
        const match = resp.content.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            const results = JSON.parse(match[0]);
            let applied = 0;
            rows.forEach((r, i) => {
              if (results[i]) {
                r.category = results[i].category || 'JOB';
                r.isJob = results[i].isJob !== false;
                r.play = results[i].play || '—';
                r.draft = results[i].draft || '';
                applied++;
              } else {
                this.fallback(r, 'missing_result');
              }
            });
            return applied;
          } catch (e) {
            LOG.warn(`ai:classify:${provider}`, `Parse failed`);
          }
        }
      } else {
        LOG.warn(`ai:classify:${provider}`, resp.reason);
      }

      provider = this.getNextProvider(provider, keys);
      if (provider) LOG.info('ai:classify', `Failover to ${provider}`);
    }

    rows.forEach(r => this.fallback(r, 'all_failed'));
    return 0;
  },

  classifyAll(rows) {
    let total = 0;
    for (let i = 0; i < rows.length; i += this.BATCH_SIZE) {
      const batch = rows.slice(i, i + this.BATCH_SIZE);
      total += this.classifyBatch(batch);
    }
    return total;
  },

  fallback(r, reason) {
    r.category = 'JOB';
    r.isJob = true;
    r.draft = '';
    const msgs = { no_key: '⚠️ Add API key', auth: '⚠️ Invalid key', rate_limit: '⚠️ Rate limited', all_failed: '⚠️ LLM failed' };
    r.play = msgs[reason] || '⚠️ Sync again';
  },

  generateObservation(stats) {
    const keys = this.getKeys();
    const provider = this.selectProvider(keys);
    if (!provider) return 'Your job search snapshot.';

    const statsStr = `Sent: ${stats.sent}, Reply needed: ${stats.replyNeeded}, Follow up: ${stats.followUp}, Waiting: ${stats.waiting}, Final stage: ${stats.finalStage}`;
    const prompt = PROMPTS.digestObservation.replace('${stats}', statsStr);

    const resp = Providers[provider].call(prompt, keys[provider]);
    return resp.success ? resp.content.trim().replace(/^["']|["']$/g, '') : 'Your job search snapshot.';
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════════════

function renderTable(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(CORE.SHEETS.MAIN);
  if (!dash) return;

  if (dash.getLastRow() > 1) {
    dash.getRange(2, 1, dash.getMaxRows() - 1, CORE.HEADERS.length).clearContent().clearFormat();
  }

  if (!rows.length) return;

  const data = rows.map(r => [
    false,
    r.status.label,
    r.company,
    Security.sanitize(r.play),
    Security.sanitize(r.draft),
    r.days,
    r.contact,
    r.subject.slice(0, 50),
    r.category
  ]);

  dash.getRange(2, 1, data.length, CORE.HEADERS.length).setValues(data);

  // Style
  dash.setRowHeights(2, data.length, CORE.UI.ROW_HEIGHT);
  rows.forEach((r, i) => {
    const row = i + 2;
    dash.getRange(row, 2).setBackground(r.status.bg).setFontColor(r.status.fg).setFontWeight('bold');
    dash.getRange(row, 4).setFontColor(CORE.UI.COLORS.playFg).setFontStyle('italic');
  });
  dash.getRange(2, 1, data.length, 1).insertCheckboxes();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════════

function createDailyTrigger() {
  try {
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sync').forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('sync').timeBased().everyDays(1).atHour(6).create();
    return true;
  } catch (e) {
    LOG.error('trigger', `Sync trigger failed: ${e.message}`);
    return false;
  }
}

function createDigestTrigger() {
  try {
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendDailyDigest').forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(7).create();
    return true;
  } catch (e) {
    LOG.error('trigger', `Digest trigger failed: ${e.message}`);
    return false;
  }
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC (Main orchestration)
// ═══════════════════════════════════════════════════════════════════════════════

function sync() {
  const start = Date.now();
  const stats = { total: 0, jobThreads: 0, filterCacheHits: 0, rulesIncluded: 0, llmIncluded: 0, classifyCacheHits: 0, dirty: 0, replyNeeded: 0, followUp: 0, waiting: 0 };

  try {
    Cache.load();
    const myEmail = App.session.getEmail();
    const threads = App.gmail.search('in:sent', 0, USER_CONFIG.LOOKBACK);
    stats.total = threads.length;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Parse basic info
    // ─────────────────────────────────────────────────────────────────────────
    const parsed = threads.map(t => Email.parseBasic(t));

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Filter (cache → rules → LLM)
    // ─────────────────────────────────────────────────────────────────────────
    const jobThreads = [];
    const needsFilter = [];

    parsed.forEach(p => {
      const cached = Cache.get(p.id);
      if (cached && cached.isJobThread !== undefined) {
        stats.filterCacheHits++;
        if (cached.isJobThread) jobThreads.push(p);
      } else {
        needsFilter.push(p);
      }
    });

    // Rules pass
    const rulesIncluded = [];
    const uncertain = [];

    needsFilter.forEach(p => {
      const result = Filters.classify(p, myEmail);
      if (result.action === 'include') {
        p.filterSource = 'rules';
        stats.rulesIncluded++;
        rulesIncluded.push(p);
      } else if (result.action === 'uncertain') {
        uncertain.push(p);
      } else {
        // Excluded by rules — save to cache as not-job
        Cache.set(p.id, { isJobThread: false, filterSource: 'rules' });
      }
    });

    jobThreads.push(...rulesIncluded);

    // LLM pass for uncertain
    if (uncertain.length > 0) {
      const indices = AI.preFilter(uncertain);
      if (indices) {
        uncertain.forEach((p, i) => {
          if (indices.includes(i)) {
            p.filterSource = 'llm';
            stats.llmIncluded++;
            jobThreads.push(p);
            Cache.set(p.id, { isJobThread: true, filterSource: 'llm' });
          } else {
            Cache.set(p.id, { isJobThread: false, filterSource: 'llm' });
          }
        });
      } else {
        // LLM failed — include all uncertain (conservative)
        uncertain.forEach(p => {
          p.filterSource = 'fallback';
          stats.llmIncluded++;
          jobThreads.push(p);
          Cache.set(p.id, { isJobThread: true, filterSource: 'fallback' });
        });
        LOG.warn('filter', `LLM failed, including ${uncertain.length} uncertain`);
      }
    }

    stats.jobThreads = jobThreads.length;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Full parse + classify
    // ─────────────────────────────────────────────────────────────────────────
    const rows = jobThreads.map(p => Email.parseFull(p.thread, Cache.get(p.id), myEmail));
    rows.forEach(r => {
      r.status = Status.compute(r);
      if (!r.isDirty && r.cached) {
        r.category = r.cached.category;
        r.isJob = r.cached.isJob;
        r.play = r.cached.play;
        r.draft = r.cached.draft;
        stats.classifyCacheHits++;
      }
    });

    const dirty = rows.filter(r => r.isDirty);
    stats.dirty = dirty.length;

    if (dirty.length > 0) {
      AI.classifyAll(dirty);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Save + render
    // ─────────────────────────────────────────────────────────────────────────
    Cache.save(rows);
    renderTable(rows);

    stats.replyNeeded = rows.filter(r => r.status.label === 'Reply Needed').length;
    stats.followUp = rows.filter(r => r.status.label === 'Follow Up').length;
    stats.waiting = rows.filter(r => r.status.label === 'Waiting').length;

    LOG.summary(stats);
    TELEMETRY.send('sync', { ...stats, runtime: Date.now() - start });

    return { stats, rows };

  } catch (e) {
    LOG.error('sync', e.message);
    TELEMETRY.send('error', { stage: 'sync', msg: e.message });
    throw e;
  }
}

function syncFresh() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cache = ss.getSheetByName(CORE.SHEETS.CACHE);
  if (cache && cache.getLastRow() > 1) {
    cache.deleteRows(2, cache.getLastRow() - 1);
  }
  ss.toast('Re-filtering and re-classifying all threads...', '🔄 Fresh Sync', 3);
  sync();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY DIGEST
// ═══════════════════════════════════════════════════════════════════════════════

function sendDailyDigest() {
  try {
    Cache.load();
    const myEmail = App.session.getEmail();
    const threads = App.gmail.search('in:sent', 0, USER_CONFIG.LOOKBACK);

    // Quick filter: only cached job threads
    const jobRows = [];
    threads.forEach(t => {
      const cached = Cache.get(t.getId());
      if (cached?.isJobThread) {
        const row = Email.parseFull(t, cached, myEmail);
        row.status = Status.compute(row);
        Object.assign(row, cached);
        jobRows.push(row);
      }
    });

    const replyNeeded = jobRows.filter(r => r.status.label === 'Reply Needed');
    const followUp = jobRows.filter(r => r.status.label === 'Follow Up');
    const waiting = jobRows.filter(r => r.status.label === 'Waiting');

    if (replyNeeded.length === 0 && followUp.length === 0) {
      LOG.info('digest', 'No action items, skipping');
      return;
    }

    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const stats = {
      sent: jobRows.length,
      newCount: jobRows.filter(r => (r.firstSeen || 0) > sevenDaysAgo).length,
      replyNeeded: replyNeeded.length,
      followUp: followUp.length,
      waiting: waiting.length,
      finalStage: jobRows.filter(r => USER_CONFIG.FINAL_CATEGORIES.includes(r.category)).length
    };

    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
    const observation = AI.generateObservation(stats);

    const first = replyNeeded[0] || followUp[0];
    const firstName = first.contact.split('.')[0].replace(/^\w/, c => c.toUpperCase());
    const actionCount = replyNeeded.length + followUp.length - 1;
    const subject = actionCount > 0 ? `Reply to ${firstName} @ ${first.company} — and ${actionCount} more` : `Reply to ${firstName} @ ${first.company}`;

    let body = `${firstName},\n\n${weekday}. ${observation}\n\n`;

    const formatRow = r => {
      const name = r.contact.split('.').map(s => s.replace(/^\w/, c => c.toUpperCase())).join(' ');
      return `**${name}, ${r.company}** · ${r.days}d\n${r.play}\n\n${r.draft}\n\nhttps://mail.google.com/mail/u/0/#inbox/${r.id}\n\n`;
    };

    replyNeeded.forEach(r => { body += formatRow(r); });
    if (followUp.length) {
      body += '---\n\n**Follow up this week**\n\n';
      followUp.forEach(r => { body += formatRow(r); });
    }

    body += '—\n\n';
    if (waiting.length) {
      body += waiting.slice(0, 3).map(r => `${r.contact.split('.')[0].replace(/^\w/, c => c.toUpperCase())} at ${r.company}`).join(', ') + ' — watching.\n\n';
    }
    body += `${stats.sent} sent · ${stats.newCount} new · ${stats.finalStage} at final stage`;

    GmailApp.sendEmail(myEmail, subject, body);
    LOG.info('digest', `Sent: ${replyNeeded.length} reply, ${followUp.length} follow up`);

  } catch (e) {
    LOG.error('digest', e.message);
  }
}

function sendWelcomeEmail(sheetUrl, consent) {
  try {
    const email = Session.getActiveUser().getEmail();
    
    const subject = 'Job Co-Pilot is set up';
    
    const body = `Hey,

Your job search dashboard is ready.

What happens now:
${consent.autoSync ? '• 6am — syncs your sent emails, filters job threads' : '• Manual sync only (auto-sync disabled)'}
${consent.digest ? '• 7am — digest email with your top plays' : '• No digest emails (disabled)'}

Quick links:
- Dashboard: ${sheetUrl}
- Docs: https://github.com/aniketh3014/job-search-copilot

Privacy: Your emails stay in your Google account. The AI only sees thread metadata and generates plays locally. Nothing stored externally except anonymous usage stats.

Questions? Reply here or find me on LinkedIn:
https://linkedin.com/in/anikethmaddipati

Good luck out there.

— Aniketh`;

    GmailApp.sendEmail(email, subject, body);
    LOG.info('welcome', 'Sent welcome email');
  } catch (e) {
    LOG.warn('welcome', `Failed: ${e.message}`);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

function saveAndInit(keys, context, consent) {
  context = context || {};
  consent = consent || { digest: false, autoSync: true };

  try {
    const props = PropertiesService.getScriptProperties();

    if (!keys.groq && !keys.gemini) throw new Error('Please provide at least one API key');

    if (keys.groq) props.setProperty('GROQ_KEY', keys.groq);
    if (keys.gemini) props.setProperty('GEMINI_KEY', keys.gemini);

    // Test key
    const provider = AI.selectProvider(keys);
    if (!AI.testKey(provider, keys[provider])) {
      const other = AI.getNextProvider(provider, keys);
      if (!other || !AI.testKey(other, keys[other])) {
        throw new Error('API key invalid');
      }
    }

    // Save context
    if (context.linkedin) {
      const parsed = ContextParser.clean(context.linkedin, 'linkedin');
      if (parsed && ContextParser.score(parsed) >= 30) props.setProperty('USER_LINKEDIN', parsed.slice(0, 5000));
    }
    if (context.resume) {
      const parsed = ContextParser.clean(context.resume, 'resume');
      if (parsed && ContextParser.score(parsed) >= 30) props.setProperty('USER_RESUME', parsed.slice(0, 5000));
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Dashboard
    let dash = ss.getSheetByName(CORE.SHEETS.MAIN) || ss.insertSheet(CORE.SHEETS.MAIN);
    const sheet1 = ss.getSheetByName('Sheet1');
    if (sheet1 && sheet1.getLastRow() === 0) ss.deleteSheet(sheet1);

    dash.clear();
    dash.getRange(1, 1, 1, CORE.HEADERS.length).setValues([CORE.HEADERS]).setBackground(CORE.UI.COLORS.headerBg).setFontColor(CORE.UI.COLORS.headerFg).setFontWeight('bold');
    dash.setFrozenRows(1);
    CORE.WIDTHS.forEach((w, i) => dash.setColumnWidth(i + 1, w));

    // Triggers (based on consent)
    const warnings = [];
    if (consent.autoSync) {
      if (!createDailyTrigger()) warnings.push('Sync trigger failed');
    }
    if (consent.digest) {
      if (!createDigestTrigger()) warnings.push('Digest trigger failed');
    }
    
    // Welcome email
    sendWelcomeEmail(ss.getUrl(), consent);

    // Initial sync
    const { stats, rows } = sync();

    if (stats.total === 0) {
      return { success: true, empty: true, message: 'No sent emails found', sheetUrl: ss.getUrl() };
    }

    const topPlays = rows.filter(r => r.status.label !== 'Waiting').slice(0, 3).map(r => ({
      contact: r.contact.split('.')[0].replace(/^\w/, c => c.toUpperCase()),
      company: r.company,
      status: r.status.label
    }));

    TELEMETRY.send('install', stats);

    return {
      success: true,
      stats,
      topPlays,
      warnings,
      sheetUrl: ss.getUrl() + '#gid=' + dash.getSheetId(),
      scriptUrl: `https://script.google.com/d/${ScriptApp.getScriptId()}/edit`
    };

  } catch (e) {
    LOG.error('init', e.message);
    TELEMETRY.send('error', { stage: 'init', msg: e.message });
    throw new Error(e.message);
  }
}

function doGet() {
  return HtmlService.createTemplateFromFile('Setup').evaluate().setTitle('Job Co-Pilot Setup');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENU
// ═══════════════════════════════════════════════════════════════════════════════

function onOpen() {
  const ui = App.sheets.getUi();
  if (!ui) return;

  ui.createMenu('📧 Job Co-Pilot')
    .addItem('🔄 Sync Now', 'sync')
    .addItem('🔄 Sync (Fresh)', 'syncFresh')
    .addItem('📬 Send Digest Now', 'sendDailyDigest')
    .addItem('⚙️ Setup', 'showSetup')
    .addToUi();
}

function showSetup() {
  const html = HtmlService.createTemplateFromFile('Setup').evaluate().setTitle('Job Co-Pilot Setup');
  SpreadsheetApp.getUi().showSidebar(html);
}

function getDebugInfo() {
  return { scriptId: ScriptApp.getScriptId(), scriptUrl: `https://script.google.com/d/${ScriptApp.getScriptId()}/edit`, version: CORE.VERSION };
}

function clearAllProperties() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  SpreadsheetApp.getActiveSpreadsheet().toast('Properties cleared');
}

function showDebugSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName('_log');
  const cache = ss.getSheetByName('_cache');
  
  if (log) log.showSheet();
  if (cache) cache.showSheet();
  
  SpreadsheetApp.getActiveSpreadsheet().toast('Debug sheets visible', '✓');
}

function hideDebugSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName('_log');
  const cache = ss.getSheetByName('_cache');
  
  if (log) log.hideSheet();
  if (cache) cache.hideSheet();
  
  SpreadsheetApp.getActiveSpreadsheet().toast('Debug sheets hidden', '✓');
}