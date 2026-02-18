/**
 * 📧 Job Search Co-Pilot v1.2.0
 * AI-powered job search triage in Google Sheets
 * * @author Aniketh Maddipati
 * @license MIT
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

const PROMPTS = {
  classify: `You are a job search strategist helping a candidate manage their outreach.

For each thread, return:
{
  "category": "JOB" | "NETWORKING" | "OTHER",
  "isJob": boolean,
  "play": "One specific sentence. What should the candidate do next?",
  "draft": "Ready-to-send reply (250-280 chars). Address the RECIPIENT by name."
}

RULES:
- The candidate is SENDING. Drafts are TO the contact, not to the candidate.
- Start draft with "Hi [Contact]" using the contact's name from the thread data.
- Be SPECIFIC. Reference actual email content.
- Never use: "just following up", "circling back", "touching base"
- Reply Needed: Address what they asked
- Follow Up (5+ days): Add a hook, don't just bump
- Waiting (<5 days): Return play: "—", draft: ""

THREADS:
\${threads}

Return JSON array only.
[{...},{...},...]`
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const USER_CONFIG = {
  LOOKBACK: 50,
  FOLLOWUP_DAYS: 5,
  LOG_LEVEL: 'INFO',
  USE_LLM: true,
  FORCE_JOB_DOMAINS: [],
  IGNORE_DOMAINS: [],
  BLOCKS: [],
};

const CORE = Object.freeze({
  VERSION: '1.2.0',
  CACHE_VERSION: 1,  // Bump this to invalidate all user caches
  SHEETS: { MAIN: 'Dashboard', CACHE: '_cache' },  CACHE_COLS: ['id', 'messageCount', 'category', 'isJob', 'play', 'draft', 'updatedAt'],
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
      followUp: { bg: '#fef7e0', fg: '#e37400' },
      waiting: { bg: '#e8f0fe', fg: '#1967d2' },
      done: { bg: '#f5f5f5', fg: '#9e9e9e' },
      playFg: '#1a73e8',
      muted: '#5f6368',
    },
  },
  RATE_LIMIT_MS: 60000,
});

const ALL_HEADERS = [...CORE.HEADERS, ...USER_CONFIG.BLOCKS.map(b => b.label)];
const ALL_WIDTHS = [...CORE.WIDTHS, ...USER_CONFIG.BLOCKS.map(b => b.width || 100)];

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGER (Event Log for Debugging)
// ═══════════════════════════════════════════════════════════════════════════════

const LOG = {
  SHEET_NAME: '_log',
  MAX_ROWS: 200,
  
  _sheet: null,
  
  _getSheet() {
    if (this._sheet) return this._sheet;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(this.SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(this.SHEET_NAME);
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
      const time = new Date().toLocaleTimeString();
      sheet.appendRow([time, level, stage, message]);
      
      if (sheet.getLastRow() > this.MAX_ROWS) {
        sheet.deleteRows(2, sheet.getLastRow() - this.MAX_ROWS);
      }
    } catch (e) {
      console.log(`LOG FAILED: ${level} ${stage} ${message}`);
    }
  },
  
  info(stage, message) { this._write('INFO', stage, message); },
  warn(stage, message) { this._write('WARN', stage, message); },
  error(stage, message) { this._write('ERROR', stage, message); },
  
  clear() {
    const sheet = this._getSheet();
    if (sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
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
        payload: JSON.stringify({
          ts: new Date().toISOString(),
          uid: this._getUid(),
          v: CORE.VERSION,
          ...data
        }),
        muteHttpExceptions: true
      });
    } catch (e) {
      console.log('Telemetry failed:', e.message);
    }
  },
  
  install(stats) {
    LOG.info('telemetry', 'Sending install event');
    this._send({
      event: 'install',
      threads: stats.total || 0,
      reply: stats.replyNeeded || 0,
      follow: stats.followUp || 0,
      wait: stats.waiting || 0
    });
  },
  
  sync(stats, runtime, llmCalls, cacheHits) {
    this._send({
      event: 'sync',
      threads: stats.total || 0,
      reply: stats.replyNeeded || 0,
      follow: stats.followUp || 0,
      wait: stats.waiting || 0,
      runtime: runtime || 0,
      llm_calls: llmCalls || 0,
      cache_hits: cacheHits || 0
    });
  },
  
  error(stage, message) {
    this._send({
      event: 'error',
      error_stage: stage || 'unknown',
      error_msg: (message || 'unknown error').slice(0, 100)
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTERS & UTILS
// ═══════════════════════════════════════════════════════════════════════════════

const App = {
  gmail: { search: (q, start, max) => GmailApp.search(q, start, max) },
  sheets: {
    getActive: () => SpreadsheetApp.getActiveSpreadsheet(),
    getSheet: (ss, name) => ss.getSheetByName(name),
    createSheet: (ss, name) => ss.insertSheet(name),
    getUi: () => { try { return SpreadsheetApp.getUi(); } catch { return null; } },
  },
  props: {
    get: (k) => PropertiesService.getScriptProperties().getProperty(k),
    set: (k, v) => PropertiesService.getScriptProperties().setProperty(k, v),
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
  fetch: {
    post: (url, opts) => UrlFetchApp.fetch(url, { 
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, ...opts 
    }),
  }
};

const Security = {
  stripPII: (s) => !s ? '' : s.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]').replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone]'),
  sanitize: (s) => {
    if (typeof s !== 'string' || !s.trim()) return '—';
    return /^[=+\-@]/.test(s.trim()) ? "'" + s : s;
  },
  validateAI: (arr, len) => Array.isArray(arr) && arr.length === len,
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
      id, messageCount, company, contact: to.split('@')[0], subject: msgs[0].getSubject(),
      days, fromMe, body: Security.stripPII(last.getPlainBody().slice(0, 300)), 
      cached, isDirty: !cached || cached.messageCount !== messageCount
    };
  }
};

const Cache = {
  _data: new Map(),
  load() {
    const sheet = App.sheets.getSheet(App.sheets.getActive(), CORE.SHEETS.CACHE);
    if (!sheet || sheet.getLastRow() <= 1) return this._data;
    
    // Check cache version (stored in cell A1 note)
    const versionNote = sheet.getRange(1, 1).getNote();
    const cacheVersion = parseInt(versionNote) || 0;
    
    if (cacheVersion < CORE.CACHE_VERSION) {
      trace('cache', `Outdated cache v${cacheVersion}, need v${CORE.CACHE_VERSION}. Clearing.`);
      sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), CORE.CACHE_COLS.length).clearContent();
      sheet.getRange(1, 1).setNote(String(CORE.CACHE_VERSION));
      return this._data;  // Return empty, will re-fetch
    }
    
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CORE.CACHE_COLS.length).getValues();
    rows.forEach(r => r[0] && this._data.set(r[0], { messageCount: r[1], category: r[2], isJob: r[3], play: r[4], draft: r[5] }));
    return this._data;
  },
  save(rows) {
    const ss = App.sheets.getActive();
    let sheet = App.sheets.getSheet(ss, CORE.SHEETS.CACHE) || App.sheets.createSheet(ss, CORE.SHEETS.CACHE);
    const data = rows.map(r => [r.id, r.messageCount, r.category, r.isJob, r.play, r.draft, new Date()]);
    sheet.clear().getRange(1, 1, 1, CORE.CACHE_COLS.length).setValues([CORE.CACHE_COLS]);
    sheet.getRange(1, 1).setNote(String(CORE.CACHE_VERSION));  // Store version
    if (data.length) sheet.getRange(2, 1, data.length, CORE.CACHE_COLS.length).setValues(data);  }
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
  
  classifyAndPlay(rows) {
    trace('ai:start', { rowCount: rows.length });
    
    const key = App.props.get('GROQ_KEY');
    if (!key) {
      trace('ai:nokey', 'No API key found');
      rows.forEach(r => this.fallback(r, 'no_key'));
      return { success: false, reason: 'no_key' };
    }
    trace('ai:key', `Key found: ...${key.slice(-4)}`);
    
    // NEW: Process in batches instead of all at once
    let totalApplied = 0;
    const totalBatches = Math.ceil(rows.length / this.BATCH_SIZE);
    
    for (let i = 0; i < rows.length; i += this.BATCH_SIZE) {
      const batch = rows.slice(i, i + this.BATCH_SIZE);
      const batchNum = Math.floor(i / this.BATCH_SIZE) + 1;
      
      trace('ai:batch', `${batchNum}/${totalBatches} (${batch.length} threads)`);
      
      const result = this._processBatch(batch, key);
      if (result.success) {
        totalApplied += result.applied;
      } else {
        trace('ai:batch:fail', `Batch ${batchNum}: ${result.reason}`);
      }
    }
    
    trace('ai:done', { applied: totalApplied, total: rows.length });
    return { success: true, applied: totalApplied };
  },

  _processBatch(rows, key) {
    const threadData = rows.map(r => 
      `Co: ${r.company} | Contact: ${r.contact} | Status: ${r.status.label} | Last: ${r.body}`
    ).join('\n---\n');
    const prompt = PROMPTS.classify.replace('${threads}', threadData);
    
    let resp;
    try {
      resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': `Bearer ${key}` },
        payload: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2
        }),
        muteHttpExceptions: true
      });
    } catch (e) {
      trace('ai:network', e.message);
      rows.forEach(r => this.fallback(r, 'network'));
      return { success: false, reason: 'network' };
    }
    
    const code = resp.getResponseCode();
    trace('ai:http', code);
    
    if (code === 401) {
      rows.forEach(r => this.fallback(r, 'auth'));
      return { success: false, reason: 'auth' };
    }
    if (code === 429) {
      rows.forEach(r => this.fallback(r, 'rate_limit'));
      return { success: false, reason: 'rate_limit' };
    }
    if (code !== 200) {
      rows.forEach(r => this.fallback(r, 'error'));
      return { success: false, reason: 'http_error' };
    }
    
    let parsed;
    try {
      parsed = JSON.parse(resp.getContentText());
    } catch (e) {
      rows.forEach(r => this.fallback(r, 'error'));
      return { success: false, reason: 'parse_error' };
    }
    
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      rows.forEach(r => this.fallback(r, 'error'));
      return { success: false, reason: 'no_content' };
    }
    
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) {
      trace('ai:nojson', content.slice(0, 50));
      rows.forEach(r => this.fallback(r, 'error'));
      return { success: false, reason: 'no_json' };
    }
    
    let results;
    try {
      results = JSON.parse(match[0]);
    } catch (e) {
      rows.forEach(r => this.fallback(r, 'error'));
      return { success: false, reason: 'result_parse' };
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
  
  fallback(r) {
    r.category = 'JOB';
    r.isJob = true;
    r.play = '—';
    r.draft = '';
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER (Hardened for Bootstrap)
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER LOGIC (FLATTENED TO PREVENT SCOPING ERRORS)
// ═══════════════════════════════════════════════════════════════════════════════

function renderTable(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(CORE.SHEETS.MAIN);
  if (!dash) return;

  const colCount = 9; 

  // 1. Safe Clear
  if (dash.getLastRow() > 1) {
    dash.getRange(2, 1, dash.getMaxRows() - 1, colCount).clearContent().clearFormat();
  }
  
  // 2. Guard
  if (!rows || rows.length === 0) return;

  // 3. Map Data
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
  
  // 4. Write & Style
  dash.getRange(2, 1, data.length, colCount).setValues(data);
  
  // Call the global style function
  renderStyle(dash, rows, data.length); 
}

function renderStyle(sheet, rows, count) {
  const colCount = 9;
  const range = sheet.getRange(2, 1, count, colCount);
  
  sheet.setRowHeights(2, count, CORE.UI.ROW_HEIGHT);
  range.setFontFamily(CORE.UI.FONT).setFontSize(11).setVerticalAlignment("middle");
  
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
  // Remove existing sync triggers
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sync') {
      ScriptApp.deleteTrigger(t);
      LOG.info('trigger', 'Removed old trigger');
    }
  });
  
  // Create new daily trigger at 6am
  ScriptApp.newTrigger('sync')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  
  LOG.info('trigger', 'Created daily trigger for 6am');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  LOG.info('trigger', 'All triggers removed');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATION & BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

function sync() {
  const startTime = Date.now();
  LOG.info('sync', 'Starting sync');
  
  try {
    // Load cache
    const cache = Cache.load();
    LOG.info('cache', 'Loaded cache');
    
    // Get user email
    const myEmail = App.session.getEmail();
    LOG.info('gmail', `User: ${myEmail.slice(0, 3)}***`);
    
    // Search threads
    const threads = App.gmail.search('in:sent', 0, USER_CONFIG.LOOKBACK);
    LOG.info('gmail', `Found ${threads.length} sent threads`);
    
    // Parse threads
    const rows = threads.map(t => Email.parse(t, cache, myEmail));
    
    // Compute status
    rows.forEach(r => {
      r.status = Status.compute(r);
      if (!r.isDirty && r.cached) Object.assign(r, r.cached);
    });
    
    // Count dirty (need LLM)
    const dirty = rows.filter(r => r.isDirty);
    const cacheHits = rows.length - dirty.length;
    const llmCalls = dirty.length;
    LOG.info('cache', `Cache hits: ${cacheHits}, Need LLM: ${llmCalls}`);
    
    // Classify dirty threads
    if (llmCalls > 0) {
      LOG.info('llm', `Classifying ${llmCalls} threads...`);
      try {
        AI.classifyAndPlay(dirty);
        LOG.info('llm', 'Classification complete');
      } catch (e) {
        LOG.error('llm', `Failed: ${e.message}`);
        TELEMETRY.error('llm', e.message);
        dirty.forEach(r => AI.fallback(r));
      }
    }
    
    // Save cache
    Cache.save(rows);
    LOG.info('cache', 'Cache saved');
    
    // Render
    renderTable(rows);
    LOG.info('render', `Wrote ${rows.length} rows to Dashboard`);
    
    // Stats
    const stats = {
      total: rows.length,
      replyNeeded: rows.filter(r => r.status.label === 'Reply Needed').length,
      followUp: rows.filter(r => r.status.label === 'Follow Up').length,
      waiting: rows.filter(r => r.status.label === 'Waiting').length
    };
    
    const runtime = Date.now() - startTime;
    LOG.info('sync', `Complete in ${runtime}ms | Reply: ${stats.replyNeeded}, Follow: ${stats.followUp}, Wait: ${stats.waiting}`);
        
    // Telemetry
    TELEMETRY.sync(stats, runtime, llmCalls, cacheHits);
    
    return stats; // <--- MAKE SURE THIS RETURN IS HERE
    
  } catch (e) {
    LOG.error('sync', `Fatal: ${e.message}`);
    TELEMETRY.error('sync', e.message);
    throw e;
  }
}
function doGet() {
  // This serves the Setup.html file as a standalone web app
  return HtmlService.createTemplateFromFile('Setup').evaluate()
    .setTitle('Job Co-Pilot | Setup')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}




// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP (UPDATED TO CALL FLAT FUNCTIONS)
// ═══════════════════════════════════════════════════════════════════════════════

function saveAndInit(apiKey) {
  try {
    // 1. Save Key
    PropertiesService.getScriptProperties().setProperty('GROQ_KEY', apiKey);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 2. Build Dashboard (Frictionless: User doesn't have to create it)
    let dash = ss.getSheetByName(CORE.SHEETS.MAIN) || ss.insertSheet(CORE.SHEETS.MAIN);
    
    // 3. Formatting (The "App" look)
    dash.clear(); 
    dash.getRange(1, 1, 1, CORE.HEADERS.length)
        .setValues([CORE.HEADERS])
        .setBackground(CORE.UI.COLORS.headerBg)
        .setFontColor(CORE.UI.COLORS.headerFg)
        .setFontWeight('bold');
    dash.setFrozenRows(1);
    CORE.WIDTHS.forEach((w, i) => dash.setColumnWidth(i + 1, w));
    
    // 4. Automation & Cache Setup
    if (!ss.getSheetByName(CORE.SHEETS.CACHE)) {
      ss.insertSheet(CORE.SHEETS.CACHE).hideSheet();
    }
    createDailyTrigger();

    // 5. Run Initial Scan & Return Stats for the UI
    const stats = sync();
    
    return { 
      success: true, 
      stats: {
        total: stats.total || 0,
        opportunities: (stats.replyNeeded + stats.followUp) || 0,
        saved: (stats.total * 2) // "2 mins saved per email" logic
      },
      sheetUrl: ss.getUrl() + '#gid=' + dash.getSheetId() 
    };
  } catch (e) {
    throw new Error(e.message);
  }
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
    .addItem('⚙️ Setup', 'showSetup')
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠️ Debug')
      .addItem('📋 Show Logs & Cache', 'showDebugSheets')
      .addItem('🙈 Hide Logs & Cache', 'hideDebugSheets')
      .addItem('🗑️ Clear Cache', 'clearCache'))
    .addToUi();
}

/**
 * Clears cache and syncs — for when data seems stale
 */
function syncFresh() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cache = ss.getSheetByName(CORE.SHEETS.CACHE);
  
  if (cache && cache.getLastRow() > 1) {
    cache.deleteRows(2, cache.getLastRow() - 1);
    LOG.info('cache', 'Cache cleared for fresh sync');
  }
  
  SpreadsheetApp.getActiveSpreadsheet().toast('Refreshing all threads...', '🔄 Fresh Sync', 3);
  sync();
}

function showSetup() {
  const html = HtmlService.createTemplateFromFile('Setup')
    .evaluate()
    .setWidth(450)
    .setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'Job Co-Pilot Setup');
}


// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS (Debug & Maintenance)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clears the cache to force LLM re-classification on next sync
 * Useful for testing or when classifications seem stale
 */
function clearCache() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cache = ss.getSheetByName(CORE.SHEETS.CACHE);
  
  if (!cache) {
    SpreadsheetApp.getUi().alert('No cache found. Run Setup first.');
    return;
  }
  
  const rowCount = cache.getLastRow() - 1;
  if (rowCount > 0) {
    cache.deleteRows(2, rowCount);
  }
  
  LOG.info('cache', 'Cache cleared manually');
  SpreadsheetApp.getUi().alert(`✓ Cache cleared (${rowCount} entries removed).\n\nNext sync will re-classify all threads.`);
}

/**
 * Shows all hidden sheets (_log, _cache) for debugging
 */
function showDebugSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let shown = [];
  
  const logSheet = ss.getSheetByName('_log');
  if (logSheet) {
    logSheet.showSheet();
    shown.push('_log');
  }
  
  const cacheSheet = ss.getSheetByName('_cache');
  if (cacheSheet) {
    cacheSheet.showSheet();
    shown.push('_cache');
  }
  
  if (shown.length > 0) {
    SpreadsheetApp.getUi().alert(`✓ Showing: ${shown.join(', ')}`);
  } else {
    SpreadsheetApp.getUi().alert('No debug sheets found. Run Setup first.');
  }
}

/**
 * Hides debug sheets (_log, _cache) for cleaner view
 */
function hideDebugSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hidden = [];
  
  const logSheet = ss.getSheetByName('_log');
  if (logSheet) {
    logSheet.hideSheet();
    hidden.push('_log');
  }
  
  const cacheSheet = ss.getSheetByName('_cache');
  if (cacheSheet) {
    cacheSheet.hideSheet();
    hidden.push('_cache');
  }
  
  if (hidden.length > 0) {
    SpreadsheetApp.getUi().alert(`✓ Hidden: ${hidden.join(', ')}`);
  }
}