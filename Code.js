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
  classify: `You are a job search strategist. Analyze email threads and provide specific, actionable guidance.

For each thread, return:
{
  "category": "JOB" | "NETWORKING" | "OTHER",
  "isJob": boolean,
  "play": "One specific sentence. What exactly should they do? Reference details.",
  "draft": "Ready-to-send message (250-280 chars). Professional, warm, not desperate."
}

RULES:
- Be SPECIFIC. Reference actual email content, company news, or concrete hooks.
- Never use: "just following up", "circling back", "touching base"
- Reply Needed (they wrote last): Address what they asked directly
- Follow Up (you wrote last, 5+ days): Give a hook, don't just bump
- Waiting (you wrote last, <5 days): Return play: "—", draft: ""

THREADS:
\${threads}

Return JSON array only. Keep it tight and high signal.
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
  SHEETS: { MAIN: 'Dashboard', CACHE: '_cache' },
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
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CORE.CACHE_COLS.length).getValues();
    rows.forEach(r => r[0] && this._data.set(r[0], { messageCount: r[1], category: r[2], isJob: r[3], play: r[4], draft: r[5] }));
    return this._data;
  },
  save(rows) {
    const ss = App.sheets.getActive();
    let sheet = App.sheets.getSheet(ss, CORE.SHEETS.CACHE) || App.sheets.createSheet(ss, CORE.SHEETS.CACHE);
    const data = rows.map(r => [r.id, r.messageCount, r.category, r.isJob, r.play, r.draft, new Date()]);
    sheet.clear().getRange(1, 1, 1, CORE.CACHE_COLS.length).setValues([CORE.CACHE_COLS]);
    if (data.length) sheet.getRange(2, 1, data.length, CORE.CACHE_COLS.length).setValues(data);
  }
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
  classifyAndPlay(rows) {
    const key = App.props.get('GROQ_KEY');
    if (!key) return rows.forEach(r => this.fallback(r));
    
    const threadData = rows.map(r => `Co: ${r.company} | Status: ${r.status.label} | Last: ${r.body}`).join('\n---\n');
    const prompt = PROMPTS.classify.replace('${threads}', threadData);
    
    try {
      const resp = App.fetch.post('https://api.groq.com/openai/v1/chat/completions', {
        headers: { 'Authorization': `Bearer ${key}` },
        payload: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }] })
      });
      const result = JSON.parse(JSON.parse(resp.getContentText()).choices[0].message.content.match(/\[[\s\S]*\]/)[0]);
      rows.forEach((r, i) => { Object.assign(r, result[i]); });
    } catch (e) {
      rows.forEach(r => this.fallback(r));
    }
  },
  fallback(r) {
    r.category = 'JOB'; r.isJob = true; r.play = 'Manual review needed'; r.draft = '';
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
    
    return stats;
    
  } catch (e) {
    LOG.error('sync', `Fatal: ${e.message}`);
    TELEMETRY.error('sync', e.message);
    throw e;
  }
}
function doGet() {
  return HtmlService.createTemplateFromFile('Setup').evaluate()
    .setTitle('Job Co-Pilot | Init')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP (UPDATED TO CALL FLAT FUNCTIONS)
// ═══════════════════════════════════════════════════════════════════════════════

function saveAndInit(apiKey) {
  try {
    // 1. Core Logic: Save the Key (Must Work)
    PropertiesService.getScriptProperties().setProperty('GROQ_KEY', apiKey);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 2. Provision Dashboard
    let dash = ss.getSheetByName(CORE.SHEETS.MAIN) || ss.insertSheet(CORE.SHEETS.MAIN);
    
    // 3. UI Formatting (Wrapped in Try/Catch to prevent "Not a function" crashes)
    try {
      dash.getRange(1, 1, 1, CORE.HEADERS.length).setValues([CORE.HEADERS])
          .setFontWeight('bold')
          .setBackground('#1a1a1a')
          .setFontColor('#ffffff');
      
      dash.setFrozenRows(1);
      
      // Attempt gridline hide - if it fails, the script continues anyway
      if (typeof dash.setHideGridlines === 'function') {
        dash.setHideGridlines(true);
      } else {
        ss.setHideGridlines(true);
      }
      
      CORE.WIDTHS.forEach((w, i) => {
        if (i < dash.getMaxColumns()) dash.setColumnWidth(i + 1, w);
      });
    } catch (uiErr) {
      console.warn("Non-critical UI error ignored: " + uiErr.message);
    }
    
     // 4. Provision Cache
  if (!ss.getSheetByName(CORE.SHEETS.CACHE)) {
    const cache = ss.insertSheet(CORE.SHEETS.CACHE);
    cache.getRange(1, 1, 1, CORE.CACHE_COLS.length).setValues([CORE.CACHE_COLS]);
    cache.hideSheet();
  }

  // 5. Create daily trigger ← ADD THIS
  createDailyTrigger();

  // 6. Initial Sync (was step 5)
  const stats = sync();

  TELEMETRY.install(stats);
    
    return { 
      success: true, 
      stats: stats, 
      sheetUrl: ss.getUrl() + '#gid=' + dash.getSheetId() 
    };
  } catch (e) {
    console.error('CRITICAL BOOTSTRAP ERROR: ' + e.message);
    throw new Error(e.message);
  }
}

function onOpen() {
  App.sheets.getUi().createMenu('📧 Job Co-Pilot')
    .addItem('🔄 Sync Now', 'sync')
    .addItem('📋 View Logs', 'viewLogs')
    .addItem('⚙️ Setup', 'showSetup')
    .addToUi();
}

function viewLogs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('_log');
  if (logSheet) {
    logSheet.showSheet();
    ss.setActiveSheet(logSheet);
  } else {
    SpreadsheetApp.getUi().alert('No logs yet. Run a sync first.');
  }
}
function showSetup() {
  const url = ScriptApp.getService().getUrl();
  const html = `<script>window.open("${url}", "_blank"); google.script.host.close();</script>`;
  App.sheets.getUi().showModalDialog(HtmlService.createHtmlOutput(html), "Opening Setup...");
}

function debugSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const key = PropertiesService.getScriptProperties().getProperty('GROQ_KEY');
  
  console.log("--- SYSTEM HEALTH CHECK ---");
  console.log("1. Spreadsheet ID: " + ss.getId());
  console.log("2. API Key Present: " + (key ? "YES (Ends in ..." + key.slice(-4) + ")" : "NO"));
  
  try {
    const threads = GmailApp.search('in:sent', 0, 1);
    console.log("3. Gmail Access: SUCCESS (Found " + threads.length + " threads)");
  } catch (e) {
    console.log("3. Gmail Access: FAILED - " + e.message);
  }
  
  const dash = ss.getSheetByName('Dashboard');
  console.log("4. Dashboard Sheet: " + (dash ? "EXISTS" : "MISSING"));
}


function testTelemetryPayload() {
  const stats = { total: 10, replyNeeded: 2, followUp: 5, waiting: 3 };
  const runtime = 1000;
  const llmCalls = 0;
  const cacheHits = 10;
  
  console.log('Payload:', JSON.stringify({
    event: 'sync',
    threads: stats.total || 0,
    reply: stats.replyNeeded || 0,
    follow: stats.followUp || 0,
    wait: stats.waiting || 0,
    runtime: runtime || 0,
    llm_calls: llmCalls || 0,
    cache_hits: cacheHits || 0
  }));
}