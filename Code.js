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
  classify: `You are a job search strategist helping a candidate manage their outreach.

CANDIDATE CONTEXT:
\${candidateContext}

For each thread, return:
{
  "category": "JOB" | "NETWORKING" | "OTHER",
  "isJob": boolean,
  "play": "One specific sentence. What should the candidate do next?",
  "draft": "Ready-to-send reply (250-280 chars). Address the RECIPIENT by name. Write in the candidate's voice."
}

RULES:
- The candidate is SENDING. Drafts are TO the contact, not to the candidate.
- Start draft with "Hi [Contact]" using the contact's name from the thread data.
- Be SPECIFIC. Reference actual email content.
- Match the candidate's tone and background from the context above.
- Never use: "just following up", "circling back", "touching base"
- Reply Needed: Address what they asked
- Follow Up (5+ days): Add a hook, don't just bump
- Waiting (<5 days): play = "Wait for reply", draft = ""

THREADS:
\${threads}

Return JSON array only.
[{...},{...},...]`,

  digestObservation: `You are a sharp, no-fluff career strategist. Given this week's job search stats, write ONE punchy sentence (under 20 words) observing the most important signal. Be specific, not generic. No transitions, no fluff.

Stats:
- Sent: \${sent} threads
- New (last 7d): \${newCount}
- Reply needed: \${replyNeeded}
- Follow up: \${followUp}
- Waiting: \${waiting}
- Final stage: \${finalStage}
- Top companies: \${topCompanies}

Return only the sentence, nothing else.`
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const USER_CONFIG = {
  LOOKBACK:         50,
  FOLLOWUP_DAYS:    5,
  USE_LLM:          true,
  BLOCKS:           [],
  FINAL_CATEGORIES: ['Offer', 'Final Round', 'Contract'],
};

const CORE = Object.freeze({
  VERSION: '1.2.0',
  CACHE_VERSION: 1,
  SHEETS: { MAIN: 'Dashboard', CACHE: '_cache', LOG: '_log' },
  CACHE_COLS: ['id', 'messageCount', 'category', 'isJob', 'play', 'draft', 'updatedAt'],
  HEADERS: ['Done', 'Status', 'Company', 'The Play', 'Draft', 'Days', 'Contact', 'Subject', 'Type'],
  WIDTHS: [50, 110, 100, 280, 320, 50, 85, 200, 70],
  UI: {
    ROW_HEIGHT: 50,
    HEADER_HEIGHT: 40,
    FONT: 'Google Sans, Roboto, Arial',
    COLORS: {
      headerBg: '#1a1a1a',
      headerFg: '#ffffff',
      rowAlt: ['#ffffff', '#fafafa'],
      replyNeeded: { bg: '#fce8e6', fg: '#c5221f' },
      followUp:    { bg: '#fef7e0', fg: '#e37400' },
      waiting:     { bg: '#e8f0fe', fg: '#1967d2' },
      done:        { bg: '#f5f5f5', fg: '#9e9e9e' },
      playFg: '#1a73e8',
      muted: '#5f6368',
    },
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGER
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
      sheet.setColumnWidth(1, 100);
      sheet.setColumnWidth(2, 60);
      sheet.setColumnWidth(3, 80);
      sheet.setColumnWidth(4, 400);
      sheet.hideSheet();
    }
    this._sheet = sheet;
    return sheet;
  },

  _write(level, stage, message) {
    try {
      const sheet = this._getSheet();
      sheet.appendRow([new Date().toLocaleTimeString(), level, stage, message]);
      if (sheet.getLastRow() > this.MAX_ROWS) {
        sheet.deleteRows(2, sheet.getLastRow() - this.MAX_ROWS);
      }
    } catch (e) {
      console.log(`LOG FAILED: ${level} ${stage} ${message}`);
    }
  },

  info(stage, message)  { this._write('INFO', stage, message); },
  warn(stage, message)  { this._write('WARN', stage, message); },
  error(stage, message) { this._write('ERROR', stage, message); },

  clear() {
    const sheet = this._getSheet();
    if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
};

function trace(stage, data) {
  const msg = typeof data === 'object' ? JSON.stringify(data) : String(data);
  console.log(`[${stage}] ${msg}`);
  LOG.info(stage, msg);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TELEMETRY
// ═══════════════════════════════════════════════════════════════════════════════

const TELEMETRY = {
  endpoint: 'https://script.google.com/macros/s/AKfycbyhWg0qfM-rYgudfMEMifA29jzgCl-gJsVzKU_KjrVTdP4u_9WUjsC9dc-B_wiKXuc4/exec',
  _uid: null,

  _getUid() {
    if (this._uid) return this._uid;
    const id = SpreadsheetApp.getActiveSpreadsheet().getId();
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, id + 'copilot');
    this._uid = hash.map(b => ((b + 128) % 256).toString(16).padStart(2, '0')).join('').slice(0, 12);
    return this._uid;
  },

  _send(data) {
    try {
      UrlFetchApp.fetch(this.endpoint, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ ts: new Date().toISOString(), uid: this._getUid(), v: CORE.VERSION, ...data }),
        muteHttpExceptions: true
      });
    } catch (e) {
      console.log('Telemetry failed:', e.message);
    }
  },

  install(stats) {
    LOG.info('telemetry', 'Sending install event');
    this._send({ event: 'install', threads: stats.total || 0, reply: stats.replyNeeded || 0, follow: stats.followUp || 0, wait: stats.waiting || 0 });
  },

  sync(stats, runtime, llmCalls, cacheHits) {
    this._send({ event: 'sync', threads: stats.total || 0, reply: stats.replyNeeded || 0, follow: stats.followUp || 0, wait: stats.waiting || 0, runtime: runtime || 0, llm_calls: llmCalls || 0, cache_hits: cacheHits || 0 });
  },

  error(stage, message) {
    this._send({ event: 'error', error_stage: stage || 'unknown', error_msg: (message || 'unknown error').slice(0, 100) });
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
    del: (k) => PropertiesService.getScriptProperties().deleteProperty(k),
  },
  session: {
    _email: null,
    getEmail() {
      if (this._email) return this._email;
      const threads = GmailApp.search('in:sent', 0, 1);
      if (threads.length) {
        const from = threads[0].getMessages()[0].getFrom().toLowerCase();
        const match = from.match(/<(.+)>/) || [null, from];
        this._email = match[1] || from;
      }
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
// CONTEXT PARSER (LinkedIn + Resume)
// ═══════════════════════════════════════════════════════════════════════════════

const ContextParser = {
  clean(raw, type) {
    if (!raw || typeof raw !== 'string') return null;

    let text = raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, '')
      .trim();

    if (text.length < 50) return null;
    if (text.length > 20000) text = text.slice(0, 20000);

    return type === 'linkedin' ? this._parseLinkedIn(text) : this._parseResume(text);
  },

  _parseLinkedIn(text) {
    const noise = [
      /Skip to main content/gi, /LinkedIn/gi, /Search/gi, /Messaging/gi,
      /Notifications/gi, /\bMe\b/g, /\bWork\b/g, /Premium/gi,
      /Show all \d+ skills/gi, /Show all \d+ experiences/gi,
      /\d+ followers/gi, /\d+ connections/gi, /Contact info/gi,
      /Following/gi, /Influencers/gi, /Companies/gi, /Groups/gi,
      /Newsletters/gi, /Activity/gi, /Posts/gi, /Comments/gi,
      /See all \d+/gi, /Learn more/gi, /Report this profile/gi,
      /More actions/gi, /Open to work/gi, /Promoted/gi,
    ];
    noise.forEach(re => { text = text.replace(re, ''); });

    const sections = {};
    const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 2);

    if (lines[0]) sections.name = lines[0].slice(0, 100);
    if (lines[1] && !lines[1].match(/experience|education|skills/i)) {
      sections.headline = lines[1].slice(0, 200);
    }

    const expMatch = text.match(/Experience\s+(.{50,2000}?)(?=Education|Skills|Licenses|$)/is);
    if (expMatch) sections.experience = expMatch[1].trim().slice(0, 1500);

    const eduMatch = text.match(/Education\s+(.{20,800}?)(?=Skills|Experience|Licenses|$)/is);
    if (eduMatch) sections.education = eduMatch[1].trim().slice(0, 500);

    const skillsMatch = text.match(/Skills\s+(.{10,500}?)(?=Experience|Education|Interests|$)/is);
    if (skillsMatch) sections.skills = skillsMatch[1].trim().slice(0, 300);

    if (!sections.name && !sections.experience) return null;

    return Object.entries(sections)
      .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
      .join('\n\n');
  },

  _parseResume(text) {
    const noise = [/Page \d+ of \d+/gi, /Resume/gi, /Curriculum Vitae/gi, /References available/gi];
    noise.forEach(re => { text = text.replace(re, ''); });

    const sections = {};

    const contactMatch = text.match(/^(.{10,300}?)(?=EXPERIENCE|EDUCATION|SUMMARY|OBJECTIVE|SKILLS)/is);
    if (contactMatch) sections.contact = contactMatch[1].trim().slice(0, 200);

    const expMatch = text.match(/EXPERIENCE\s*(.{50,3000}?)(?=EDUCATION|SKILLS|PROJECTS|$)/is);
    if (expMatch) sections.experience = expMatch[1].trim().slice(0, 2000);

    const eduMatch = text.match(/EDUCATION\s*(.{20,800}?)(?=EXPERIENCE|SKILLS|PROJECTS|$)/is);
    if (eduMatch) sections.education = eduMatch[1].trim().slice(0, 500);

    const skillsMatch = text.match(/SKILLS\s*(.{10,500}?)(?=EXPERIENCE|EDUCATION|PROJECTS|$)/is);
    if (skillsMatch) sections.skills = skillsMatch[1].trim().slice(0, 300);

    if (!sections.experience && !sections.education) return null;

    return Object.entries(sections)
      .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
      .join('\n\n');
  },

  score(parsed) {
    if (!parsed) return 0;
    let score = 0;
    if (parsed.length > 200) score += 20;
    if (parsed.length > 500) score += 20;
    if (parsed.length > 1000) score += 10;
    if (/EXPERIENCE:/i.test(parsed)) score += 20;
    if (/EDUCATION:/i.test(parsed)) score += 10;
    if (/SKILLS:/i.test(parsed)) score += 10;
    if (/NAME:/i.test(parsed) || /CONTACT:/i.test(parsed)) score += 10;
    return Math.min(score, 100);
  },

  sanitizeForPrompt(text) {
    if (!text) return '';
    return text
      .replace(/```/g, '')
      .replace(/\${/g, '')
      .replace(/\{\{/g, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/SYSTEM:|USER:|ASSISTANT:/gi, '')
      .slice(0, 4000);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

const Email = {
  parse(thread, cache, myEmail) {
    const msgs = thread.getMessages();
    const last = msgs[msgs.length - 1];
    const id = thread.getId();
    const messageCount = msgs.length;
    const to = msgs[0].getTo().toLowerCase();
    const fromMe = last.getFrom().toLowerCase().includes(myEmail);
    const lastDate = last.getDate();
    const days = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
    const domain = (to.match(/@([\w.-]+)/) || [])[1] || '';
    const company = domain.split('.')[0] || 'Unknown';
    const cached = cache.get(id);

    return {
      id, messageCount, company,
      contact: to.split('@')[0],
      subject: msgs[0].getSubject(),
      days, fromMe,
      body: Security.stripPII(last.getPlainBody().slice(0, 300)),
      cached,
      isDirty: !cached || cached.messageCount !== messageCount,
      threadId: id,
      firstSeen: cached?.firstSeen || Date.now()
    };
  }
};

const Cache = {
  _data: new Map(),

  load() {
    const sheet = App.sheets.getSheet(App.sheets.getActive(), CORE.SHEETS.CACHE);
    if (!sheet || sheet.getLastRow() <= 1) return this._data;

    const versionNote = sheet.getRange(1, 1).getNote();
    const cacheVersion = parseInt(versionNote) || 0;

    if (cacheVersion < CORE.CACHE_VERSION) {
      trace('cache', `Outdated cache v${cacheVersion}, clearing.`);
      sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), CORE.CACHE_COLS.length).clearContent();
      sheet.getRange(1, 1).setNote(String(CORE.CACHE_VERSION));
      return this._data;
    }

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CORE.CACHE_COLS.length).getValues();
    rows.forEach(r => r[0] && this._data.set(r[0], {
      messageCount: r[1], category: r[2], isJob: r[3], play: r[4], draft: r[5], firstSeen: r[6]
    }));
    return this._data;
  },

  save(rows) {
    const ss = App.sheets.getActive();
    let sheet = App.sheets.getSheet(ss, CORE.SHEETS.CACHE) || App.sheets.createSheet(ss, CORE.SHEETS.CACHE);
    const data = rows.map(r => [r.id, r.messageCount, r.category, r.isJob, r.play, r.draft, r.firstSeen || Date.now()]);
    sheet.clear().getRange(1, 1, 1, CORE.CACHE_COLS.length).setValues([CORE.CACHE_COLS]);
    sheet.getRange(1, 1).setNote(String(CORE.CACHE_VERSION));
    if (data.length) sheet.getRange(2, 1, data.length, CORE.CACHE_COLS.length).setValues(data);
  },

  get(id) { return this._data.get(id); }
};

const Status = {
  compute(row) {
    if (!row.fromMe) return { label: 'Reply Needed', ...CORE.UI.COLORS.replyNeeded };
    if (row.days >= USER_CONFIG.FOLLOWUP_DAYS) return { label: 'Follow Up', ...CORE.UI.COLORS.followUp };
    return { label: 'Waiting', ...CORE.UI.COLORS.waiting };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// AI SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

const AI = {
  BATCH_SIZE: 10,

  getKeys() {
    return { groq: App.props.get('GROQ_KEY'), gemini: App.props.get('GEMINI_KEY') };
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

  selectProvider(keys) {
    if (keys.groq) return 'groq';
    if (keys.gemini) return 'gemini';
    return null;
  },

  getNextProvider(current, keys) {
    const order = ['groq', 'gemini'];
    const idx = order.indexOf(current);
    for (let i = idx + 1; i < order.length; i++) {
      if (keys[order[i]]) return order[i];
    }
    return null;
  },

  testKey(provider, key) {
    const testPrompt = 'Reply with exactly: OK';
    const response = Providers[provider].call(testPrompt, key);
    return response.success;
  },

  classifyAndPlay(rows) {
    trace('ai:start', { rowCount: rows.length });
    const keys = this.getKeys();
    let provider = this.selectProvider(keys);

    if (!provider) {
      trace('ai:nokey', 'No API keys found');
      rows.forEach(r => this.fallback(r, 'no_key'));
      return { success: false, reason: 'no_key' };
    }

    let totalApplied = 0;
    for (let i = 0; i < rows.length; i += this.BATCH_SIZE) {
      const batch = rows.slice(i, i + this.BATCH_SIZE);
      const result = this._processBatchWithFailover(batch, keys, provider);
      if (result.success) {
        totalApplied += result.applied;
        provider = result.provider;
      }
    }

    trace('ai:done', { applied: totalApplied, total: rows.length });
    return { success: true, applied: totalApplied };
  },

  _processBatchWithFailover(rows, keys, startProvider) {
    let provider = startProvider;

    while (provider) {
      trace('ai:provider', provider);
      const result = this._processBatch(rows, keys[provider], provider);
      if (result.success) return { ...result, provider };

      trace(`ai:${provider}:fail`, result.reason);
      provider = this.getNextProvider(provider, keys);
      if (provider) trace('ai:failover', `Trying ${provider}`);
    }

    rows.forEach(r => this.fallback(r, 'all_failed'));
    return { success: false, reason: 'all_providers_failed' };
  },

  _processBatch(rows, key, provider) {
    const candidateContext = this.getCandidateContext();
    const threadData = rows.map(r =>
      `Co: ${r.company} | Contact: ${r.contact} | Status: ${r.status.label} | Last: ${r.body}`
    ).join('\n---\n');

    const prompt = PROMPTS.classify
      .replace('${candidateContext}', candidateContext)
      .replace('${threads}', threadData);

    const response = Providers[provider].call(prompt, key);

    if (!response.success) {
      rows.forEach(r => this.fallback(r, response.reason));
      return { success: false, reason: response.reason };
    }

    const match = response.content.match(/\[[\s\S]*\]/);
    if (!match) {
      rows.forEach(r => this.fallback(r, 'error'));
      return { success: false, reason: 'no_json' };
    }

    let results;
    try {
      results = JSON.parse(match[0]);
    } catch (e) {
      rows.forEach(r => this.fallback(r, 'error'));
      return { success: false, reason: 'parse_error' };
    }

    let applied = 0;
    rows.forEach((r, i) => {
      if (results[i]) {
        r.category = results[i].category || 'JOB';
        r.isJob = results[i].isJob !== false;
        r.play = results[i].play || '—';
        r.draft = results[i].draft || '';
        applied++;
      } else {
        this.fallback(r, 'error');
      }
    });

    return { success: true, applied };
  },

  generateObservation(stats) {
    const keys = this.getKeys();
    const provider = this.selectProvider(keys);
    if (!provider) return 'Your weekly job search snapshot.';

    const prompt = PROMPTS.digestObservation
      .replace('${sent}', stats.sent)
      .replace('${newCount}', stats.newCount)
      .replace('${replyNeeded}', stats.replyNeeded)
      .replace('${followUp}', stats.followUp)
      .replace('${waiting}', stats.waiting)
      .replace('${finalStage}', stats.finalStage)
      .replace('${topCompanies}', stats.topCompanies);

    const response = Providers[provider].call(prompt, keys[provider]);
    if (response.success && response.content) {
      return response.content.trim().replace(/^["']|["']$/g, '');
    }
    return 'Your weekly job search snapshot.';
  },

  fallback(r, reason) {
    r.category = 'JOB';
    r.isJob = true;
    r.draft = '';

    const messages = {
      no_key: '⚠️ Add API key in Setup',
      auth: '⚠️ Invalid API key',
      rate_limit: '⚠️ Rate limited - try later',
      network: '⚠️ Network error',
      all_failed: '⚠️ All providers failed - try later'
    };
    r.play = messages[reason] || '⚠️ Sync again to classify';
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDERS
// ═══════════════════════════════════════════════════════════════════════════════

const Providers = {
  groq: {
    name: 'Groq',
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
        if (code !== 200) {
          return { success: false, code, reason: code === 401 ? 'auth' : code === 429 ? 'rate_limit' : 'http_error' };
        }

        const parsed = JSON.parse(resp.getContentText());
        const content = parsed.choices?.[0]?.message?.content;
        return content ? { success: true, content } : { success: false, reason: 'no_content' };
      } catch (e) {
        return { success: false, reason: 'network' };
      }
    }
  },

  gemini: {
    name: 'Gemini',
    call(prompt, key) {
      try {
        const resp = UrlFetchApp.fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
          {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            muteHttpExceptions: true
          }
        );

        const code = resp.getResponseCode();
        if (code !== 200) {
          return { success: false, code, reason: code === 400 ? 'auth' : code === 429 ? 'rate_limit' : 'http_error' };
        }

        const parsed = JSON.parse(resp.getContentText());
        const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        return content ? { success: true, content } : { success: false, reason: 'no_content' };
      } catch (e) {
        return { success: false, reason: 'network' };
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════════════

function renderTable(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(CORE.SHEETS.MAIN);
  if (!dash) return;

  const colCount = CORE.HEADERS.length;

  if (dash.getLastRow() > 1) {
    dash.getRange(2, 1, dash.getMaxRows() - 1, colCount).clearContent().clearFormat();
  }

  if (!rows || rows.length === 0) return;

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

  dash.getRange(2, 1, data.length, colCount).setValues(data);
  renderStyle(dash, rows, data.length);
}

function renderStyle(sheet, rows, count) {
  const colCount = CORE.HEADERS.length;
  const range = sheet.getRange(2, 1, count, colCount);

  sheet.setRowHeights(2, count, CORE.UI.ROW_HEIGHT);
  range.setFontFamily(CORE.UI.FONT).setFontSize(11).setVerticalAlignment('middle');

  rows.forEach((r, i) => {
    const rowIdx = i + 2;
    sheet.getRange(rowIdx, 2).setBackground(r.status.bg).setFontColor(r.status.fg).setFontWeight('bold');
    sheet.getRange(rowIdx, 4).setFontColor(CORE.UI.COLORS.playFg).setFontStyle('italic');
  });

  sheet.getRange(2, 1, count, 1).insertCheckboxes();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════════

function createDailyTrigger() {
  try {
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('sync').timeBased().everyDays(1).atHour(6).create();
    LOG.info('trigger', 'Created daily sync trigger for 6am');
    return true;
  } catch (e) {
    LOG.error('trigger', `Failed to create sync trigger: ${e.message}`);
    return false;
  }
}

function createDigestTrigger() {
  try {
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === 'sendDailyDigest') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(7).create();
    LOG.info('trigger', 'Created daily digest trigger for 7am');
    return true;
  } catch (e) {
    LOG.error('trigger', `Failed to create digest trigger: ${e.message}`);
    return false;
  }
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  LOG.info('trigger', 'All triggers removed');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════════

function sync() {
  const startTime = Date.now();
  LOG.info('sync', 'Starting sync');

  try {
    const cache = Cache.load();
    const myEmail = App.session.getEmail();
    LOG.info('gmail', `User: ${myEmail.slice(0, 3)}***`);

    const threads = App.gmail.search('in:sent', 0, USER_CONFIG.LOOKBACK);
    LOG.info('gmail', `Found ${threads.length} sent threads`);

    const rows = threads.map(t => Email.parse(t, cache, myEmail));

    rows.forEach(r => {
      r.status = Status.compute(r);
      if (!r.isDirty && r.cached) Object.assign(r, r.cached);
    });

    const dirty = rows.filter(r => r.isDirty);
    const cacheHits = rows.length - dirty.length;
    LOG.info('cache', `Cache hits: ${cacheHits}, Need LLM: ${dirty.length}`);

    if (dirty.length > 0) {
      LOG.info('llm', `Classifying ${dirty.length} threads...`);
      try {
        AI.classifyAndPlay(dirty);
      } catch (e) {
        LOG.error('llm', `Failed: ${e.message}`);
        TELEMETRY.error('llm', e.message);
        dirty.forEach(r => AI.fallback(r, 'error'));
      }
    }

    Cache.save(rows);
    renderTable(rows);

    const stats = {
      total: rows.length,
      replyNeeded: rows.filter(r => r.status.label === 'Reply Needed').length,
      followUp: rows.filter(r => r.status.label === 'Follow Up').length,
      waiting: rows.filter(r => r.status.label === 'Waiting').length
    };

    LOG.info('sync', `Complete in ${Date.now() - startTime}ms`);
    TELEMETRY.sync(stats, Date.now() - startTime, dirty.length, cacheHits);

    return { stats, rows };
  } catch (e) {
    LOG.error('sync', `Fatal: ${e.message}`);
    TELEMETRY.error('sync', e.message);
    throw e;
  }
}

function syncFresh() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cache = ss.getSheetByName(CORE.SHEETS.CACHE);

  if (cache && cache.getLastRow() > 1) {
    cache.deleteRows(2, cache.getLastRow() - 1);
    LOG.info('cache', 'Cache cleared for fresh sync');
  }

  ss.toast('Refreshing all threads...', '🔄 Fresh Sync', 3);
  sync();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY DIGEST
// ═══════════════════════════════════════════════════════════════════════════════

function sendDailyDigest() {
  LOG.info('digest', 'Starting daily digest');

  try {
    const cache = Cache.load();
    const myEmail = App.session.getEmail();
    const threads = App.gmail.search('in:sent', 0, USER_CONFIG.LOOKBACK);
    const rows = threads.map(t => Email.parse(t, cache, myEmail));

    rows.forEach(r => {
      r.status = Status.compute(r);
      if (!r.isDirty && r.cached) Object.assign(r, r.cached);
    });

    const replyNeeded = rows.filter(r => r.status.label === 'Reply Needed');
    const followUp = rows.filter(r => r.status.label === 'Follow Up');
    const waiting = rows.filter(r => r.status.label === 'Waiting');

    if (replyNeeded.length === 0 && followUp.length === 0) {
      LOG.info('digest', 'No action items, skipping digest');
      return;
    }

    const sevenDaysAgo = Date.now() - (7 * 86400000);
    const newCount = rows.filter(r => (r.firstSeen || 0) > sevenDaysAgo).length;
    const finalStage = rows.filter(r => USER_CONFIG.FINAL_CATEGORIES.includes(r.category)).length;

    const companyCounts = {};
    rows.forEach(r => { companyCounts[r.company] = (companyCounts[r.company] || 0) + 1; });
    const topCompanies = Object.entries(companyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name)
      .join(', ');

    const stats = { sent: rows.length, newCount, replyNeeded: replyNeeded.length, followUp: followUp.length, waiting: waiting.length, finalStage, topCompanies };

    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
    const observation = AI.generateObservation(stats);

    const firstAction = replyNeeded[0] || followUp[0];
    const firstName = firstAction.contact.split('.')[0].replace(/^\w/, c => c.toUpperCase());
    const actionCount = replyNeeded.length + followUp.length - 1;
    const subject = actionCount > 0
      ? `Reply to ${firstName} @ ${firstAction.company} — and ${actionCount} more`
      : `Reply to ${firstName} @ ${firstAction.company}`;

    let body = `${firstName},\n\n${weekday}. ${observation}\n\n`;

    const formatRow = (r) => {
      const name = r.contact.split('.').map(s => s.replace(/^\w/, c => c.toUpperCase())).join(' ');
      const link = `https://mail.google.com/mail/u/0/#inbox/${r.threadId}`;
      return `**${name}, ${r.company}** · ${r.days}d\n${r.play}\n\n${r.draft}\n\n${link}\n\n`;
    };

    replyNeeded.forEach(r => { body += formatRow(r); });

    if (followUp.length > 0) {
      body += '---\n\n**Follow up this week**\n\n';
      followUp.forEach(r => { body += formatRow(r); });
    }

    body += '—\n\n';

    if (waiting.length > 0) {
      const watchingNames = waiting.slice(0, 3).map(r => {
        const name = r.contact.split('.')[0].replace(/^\w/, c => c.toUpperCase());
        return `${name} at ${r.company}`;
      }).join(', ');
      body += `${watchingNames} — watching.\n\n`;
    }

    body += `${stats.sent} sent · ${stats.newCount} new · ${stats.finalStage} at final stage\n`;
    body += 'jobcopilot.com/settings';

    GmailApp.sendEmail(myEmail, subject, body);
    LOG.info('digest', `Sent digest: ${replyNeeded.length} reply, ${followUp.length} follow up`);

  } catch (e) {
    LOG.error('digest', `Failed: ${e.message}`);
    TELEMETRY.error('digest', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

function saveAndInit(keys, context) {
  context = context || {};

  try {
    const props = PropertiesService.getScriptProperties();

    // Validate at least one key
    if (!keys.groq && !keys.gemini) {
      throw new Error('Please provide at least one API key');
    }

    // Save keys
    if (keys.groq) props.setProperty('GROQ_KEY', keys.groq);
    if (keys.gemini) props.setProperty('GEMINI_KEY', keys.gemini);

    // Test key validity
    const provider = AI.selectProvider(keys);
    if (!AI.testKey(provider, keys[provider])) {
      const other = AI.getNextProvider(provider, keys);
      if (!other || !AI.testKey(other, keys[other])) {
        throw new Error('API key invalid. Please check and try again.');
      }
    }

    // Save context (LinkedIn/Resume)
    if (context.linkedin) {
      const parsed = ContextParser.clean(context.linkedin, 'linkedin');
      if (parsed && ContextParser.score(parsed) >= 30) {
        props.setProperty('USER_LINKEDIN', parsed.slice(0, 5000));
      }
    }
    if (context.resume) {
      const parsed = ContextParser.clean(context.resume, 'resume');
      if (parsed && ContextParser.score(parsed) >= 30) {
        props.setProperty('USER_RESUME', parsed.slice(0, 5000));
      }
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Create dashboard
    let dash = ss.getSheetByName(CORE.SHEETS.MAIN) || ss.insertSheet(CORE.SHEETS.MAIN);

    // Clean up Sheet1 if empty
    const sheet1 = ss.getSheetByName('Sheet1');
    if (sheet1 && sheet1.getLastRow() === 0) {
      ss.deleteSheet(sheet1);
    }

    // Format dashboard
    dash.clear();
    dash.getRange(1, 1, 1, CORE.HEADERS.length)
      .setValues([CORE.HEADERS])
      .setBackground(CORE.UI.COLORS.headerBg)
      .setFontColor(CORE.UI.COLORS.headerFg)
      .setFontWeight('bold');
    dash.setFrozenRows(1);
    CORE.WIDTHS.forEach((w, i) => dash.setColumnWidth(i + 1, w));

    // Create cache sheet
    if (!ss.getSheetByName(CORE.SHEETS.CACHE)) {
      ss.insertSheet(CORE.SHEETS.CACHE).hideSheet();
    }

    // Create triggers
    const syncTriggerOk = createDailyTrigger();
    const digestTriggerOk = createDigestTrigger();

    // Run initial sync
    let result;
    try {
      result = sync();
    } catch (e) {
      if (e.message.includes('Access denied') || e.message.includes('Permission')) {
        throw new Error('Gmail access required. Please authorize and try again.');
      }
      throw e;
    }

    const { stats, rows } = result;

    // Handle no emails case
    if (stats.total === 0) {
      return {
        success: true,
        empty: true,
        message: 'No sent emails found. Start sending and sync again!',
        sheetUrl: ss.getUrl() + '#gid=' + dash.getSheetId()
      };
    }

    // Build top plays for success screen
    const topPlays = rows
      .filter(r => r.status.label !== 'Waiting')
      .slice(0, 3)
      .map(r => ({
        contact: r.contact.split('.')[0].replace(/^\w/, c => c.toUpperCase()),
        company: r.company,
        status: r.status.label
      }));

    // Warnings
    const warnings = [];
    if (!syncTriggerOk) warnings.push('Daily sync trigger failed — run manually from menu');
    if (!digestTriggerOk) warnings.push('Digest trigger failed — run manually from menu');

    return {
      success: true,
      stats: {
        total: stats.total,
        replyNeeded: stats.replyNeeded,
        followUp: stats.followUp,
        opportunities: stats.replyNeeded + stats.followUp
      },
      topPlays,
      warnings,
      sheetUrl: ss.getUrl() + '#gid=' + dash.getSheetId(),
      scriptUrl: `https://script.google.com/d/${ScriptApp.getScriptId()}/edit`
    };

  } catch (e) {
    LOG.error('init', e.message);
    TELEMETRY.error('init', e.message);
    throw new Error(e.message);
  }
}

function doGet() {
  return HtmlService.createTemplateFromFile('Setup').evaluate()
    .setTitle('Job Co-Pilot | Setup')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠️ Debug')
      .addItem('📋 Show Logs & Cache', 'showDebugSheets')
      .addItem('🙈 Hide Logs & Cache', 'hideDebugSheets')
      .addItem('🗑️ Clear Cache', 'clearCache'))
    .addToUi();
}

function showSetup() {
  const html = HtmlService.createTemplateFromFile('Setup').evaluate().setTitle('Job Co-Pilot Setup');
  SpreadsheetApp.getUi().showSidebar(html);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function clearCache() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cache = ss.getSheetByName(CORE.SHEETS.CACHE);

  if (!cache) {
    SpreadsheetApp.getUi().alert('No cache found. Run Setup first.');
    return;
  }

  const rowCount = cache.getLastRow() - 1;
  if (rowCount > 0) cache.deleteRows(2, rowCount);

  LOG.info('cache', 'Cache cleared manually');
  SpreadsheetApp.getUi().alert(`✓ Cache cleared (${rowCount} entries).\n\nNext sync will re-classify all threads.`);
}

function showDebugSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shown = [];

  [CORE.SHEETS.LOG, CORE.SHEETS.CACHE].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) { sheet.showSheet(); shown.push(name); }
  });

  SpreadsheetApp.getUi().alert(shown.length ? `✓ Showing: ${shown.join(', ')}` : 'No debug sheets found.');
}

function hideDebugSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hidden = [];

  [CORE.SHEETS.LOG, CORE.SHEETS.CACHE].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) { sheet.hideSheet(); hidden.push(name); }
  });

  if (hidden.length) SpreadsheetApp.getUi().alert(`✓ Hidden: ${hidden.join(', ')}`);
}

function getDebugInfo() {
  return {
    scriptId: ScriptApp.getScriptId(),
    scriptUrl: `https://script.google.com/d/${ScriptApp.getScriptId()}/edit`,
    version: CORE.VERSION
  };
}