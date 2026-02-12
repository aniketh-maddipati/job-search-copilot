/**
 * 🧪 Job Search Co-Pilot - Test Suite
 * 
 * Run these tests to verify functionality without API calls.
 * 
 * Usage:
 *   1. In Apps Script, run: runAllTests()
 *   2. Check execution log for results
 * 
 * Tests are organized as:
 *   - Unit tests: Pure functions, no mocks needed
 *   - Integration tests: Use mocked adapters
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const TEST_CONFIG = {
  VERBOSE: true,  // Show all test output
  STOP_ON_FAIL: false,  // Continue running after failure
};


// ═══════════════════════════════════════════════════════════════════════════════
// MOCK ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════════

const MockApp = {
  gmail: {
    _threads: [],
    
    setThreads(threads) {
      this._threads = threads;
    },
    
    search(query, start, max) {
      return this._threads.slice(start, start + max);
    },
  },
  
  sheets: {
    _data: {},
    _toasts: [],
    
    getActive() {
      return MockSpreadsheet;
    },
    
    getUi() {
      return null;  // No UI in tests
    },
    
    toast(msg, title, timeout) {
      this._toasts.push({ msg, title, timeout });
    },
    
    reset() {
      this._data = {};
      this._toasts = [];
    },
  },
  
  props: {
    _store: {},
    
    get(key) {
      return this._store[key] || null;
    },
    
    set(key, value) {
      this._store[key] = value;
    },
    
    reset() {
      this._store = {};
    },
  },
  
  session: {
    _email: 'testuser@gmail.com',
    
    getEmail() {
      return this._email;
    },
    
    setEmail(email) {
      this._email = email;
    },
  },
  
  fetch: {
    _responses: {},
    _calls: [],
    
    setResponse(urlPattern, response) {
      this._responses[urlPattern] = response;
    },
    
    post(url, opts) {
      this._calls.push({ url, opts });
      
      for (const [pattern, response] of Object.entries(this._responses)) {
        if (url.includes(pattern)) {
          return MockResponse(response);
        }
      }
      
      return MockResponse({ error: 'No mock configured' }, 500);
    },
    
    reset() {
      this._responses = {};
      this._calls = [];
    },
  },
  
  util: {
    _now: Date.now(),
    
    sleep(ms) {
      // No-op in tests
    },
    
    now() {
      return this._now;
    },
    
    setNow(ts) {
      this._now = ts;
    },
    
    reset() {
      this._now = Date.now();
    },
  },
};

// Mock Spreadsheet
const MockSpreadsheet = {
  _sheets: {},
  
  getSheetByName(name) {
    return this._sheets[name] || null;
  },
  
  insertSheet(name) {
    this._sheets[name] = new MockSheet(name);
    return this._sheets[name];
  },
  
  reset() {
    this._sheets = {};
  },
};

// Mock Sheet
class MockSheet {
  constructor(name) {
    this.name = name;
    this._data = [];
    this._notes = {};
    this._lastRow = 0;
  }
  
  getName() {
    return this.name;
  }
  
  getLastRow() {
    return this._lastRow;
  }
  
  getRange(row, col, numRows = 1, numCols = 1) {
    return new MockRange(this, row, col, numRows, numCols);
  }
  
  getDataRange() {
    return new MockRange(this, 1, 1, this._lastRow, 10);
  }
  
  setColumnWidth() { return this; }
  setRowHeight() { return this; }
  setRowHeights() { return this; }
  setFrozenRows() { return this; }
  setHiddenGridlines() { return this; }
  setConditionalFormatRules() { return this; }
  hideSheet() { return this; }
  
  _setData(row, col, values) {
    for (let r = 0; r < values.length; r++) {
      const rowIdx = row - 1 + r;
      if (!this._data[rowIdx]) this._data[rowIdx] = [];
      for (let c = 0; c < values[r].length; c++) {
        this._data[rowIdx][col - 1 + c] = values[r][c];
      }
    }
    this._lastRow = Math.max(this._lastRow, row + values.length - 1);
  }
  
  _getData(row, col, numRows, numCols) {
    const result = [];
    for (let r = 0; r < numRows; r++) {
      const rowData = [];
      for (let c = 0; c < numCols; c++) {
        rowData.push(this._data[row - 1 + r]?.[col - 1 + c] || '');
      }
      result.push(rowData);
    }
    return result;
  }
}

// Mock Range
class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this._sheet = sheet;
    this._row = row;
    this._col = col;
    this._numRows = numRows;
    this._numCols = numCols;
  }
  
  setValues(values) {
    this._sheet._setData(this._row, this._col, values);
    return this;
  }
  
  getValues() {
    return this._sheet._getData(this._row, this._col, this._numRows, this._numCols);
  }
  
  setValue(value) {
    this.setValues([[value]]);
    return this;
  }
  
  getValue() {
    return this.getValues()[0][0];
  }
  
  setNote(note) {
    this._sheet._notes[`${this._row},${this._col}`] = note;
    return this;
  }
  
  getNote() {
    return this._sheet._notes[`${this._row},${this._col}`] || '';
  }
  
  getNotes() {
    const notes = [];
    for (let r = 0; r < this._numRows; r++) {
      const row = [];
      for (let c = 0; c < this._numCols; c++) {
        row.push(this._sheet._notes[`${this._row + r},${this._col + c}`] || '');
      }
      notes.push(row);
    }
    return notes;
  }
  
  clearContent() { return this; }
  clearDataValidations() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
  setFontFamily() { return this; }
  setFontSize() { return this; }
  setFontStyle() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setWrap() { return this; }
  insertCheckboxes() { return this; }
}

// Mock HTTP Response
function MockResponse(body, code = 200) {
  return {
    getResponseCode: () => code,
    getContentText: () => typeof body === 'string' ? body : JSON.stringify(body),
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATA FACTORIES
// ═══════════════════════════════════════════════════════════════════════════════

function createMockThread(opts = {}) {
  const defaults = {
    id: 'thread_' + Math.random().toString(36).slice(2, 10),
    subject: 'Test Subject',
    from: 'contact@company.com',
    to: 'testuser@gmail.com',
    body: 'This is a test email body.',
    date: new Date(),
    messageCount: 1,
    lastFromMe: false,
  };
  
  const config = { ...defaults, ...opts };
  
  const messages = [];
  for (let i = 0; i < config.messageCount; i++) {
    const isLast = i === config.messageCount - 1;
    messages.push({
      getFrom: () => isLast && config.lastFromMe ? 'testuser@gmail.com' : config.from,
      getTo: () => config.to,
      getSubject: () => config.subject,
      getPlainBody: () => config.body,
      getDate: () => config.date,
    });
  }
  
  return {
    getId: () => config.id,
    getMessages: () => messages,
  };
}

function createMockAIResponse(threads) {
  return threads.map(t => ({
    category: 'JOB',
    isJob: true,
    play: `Follow up with ${t.contact || 'contact'} about the role`,
    draft: `Hey ${t.contact || 'there'}, wanted to check in about the opportunity. Free this week?`,
  }));
}


// ═══════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

function runAllTests() {
  console.log('═'.repeat(60));
  console.log('🧪 JOB SEARCH CO-PILOT - TEST SUITE');
  console.log('═'.repeat(60) + '\n');
  
  const results = [];
  
  // Unit Tests
  console.log('📦 UNIT TESTS\n');
  results.push(testSecurityStripPII());
  results.push(testSecuritySanitize());
  results.push(testSecurityValidateAIResponse());
  results.push(testEmailExtractDomain());
  results.push(testEmailExtractName());
  results.push(testEmailDomainToCompany());
  results.push(testEmailCleanBody());
  results.push(testStatusCompute());
  
  // Integration Tests
  console.log('\n📦 INTEGRATION TESTS\n');
  results.push(testCacheLoadSave());
  results.push(testCacheIsDirty());
  results.push(testAIFallbackClassify());
  results.push(testHooksPreClassify());
  
  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed);
  
  console.log('\n' + '═'.repeat(60));
  console.log(`RESULTS: ${passed}/${results.length} passed`);
  
  if (failed.length) {
    console.log('\n❌ FAILED TESTS:');
    failed.forEach(f => console.log(`   • ${f.name}: ${f.error}`));
  } else {
    console.log('\n✅ All tests passed!');
  }
  
  console.log('═'.repeat(60));
  
  return failed.length === 0;
}


// ═══════════════════════════════════════════════════════════════════════════════
// TEST UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return { name, passed: true };
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
    if (TEST_CONFIG.VERBOSE && e.stack) {
      console.log(`    Stack: ${e.stack.split('\n')[1]}`);
    }
    return { name, passed: false, error: e.message };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertContains(str, substring, message) {
  if (!str.includes(substring)) {
    throw new Error(message || `Expected "${str}" to contain "${substring}"`);
  }
}

function assertNotContains(str, substring, message) {
  if (str.includes(substring)) {
    throw new Error(message || `Expected "${str}" to NOT contain "${substring}"`);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

function testSecurityStripPII() {
  return test('Security.stripPII removes sensitive data', () => {
    // Email
    const email = Security.stripPII('Contact john@example.com for info');
    assertNotContains(email, 'john@example.com');
    assertContains(email, '[email]');
    
    // Phone
    const phone = Security.stripPII('Call me at 555-123-4567');
    assertNotContains(phone, '555-123-4567');
    assertContains(phone, '[phone]');
    
    // ZIP
    const zip = Security.stripPII('Located in 94105');
    assertNotContains(zip, '94105');
    assertContains(zip, '[zip]');
    
    // SSN
    const ssn = Security.stripPII('SSN: 123-45-6789');
    assertNotContains(ssn, '123-45-6789');
    assertContains(ssn, '[ssn]');
    
    // Multiple
    const multi = Security.stripPII('Email john@test.com, call 555-123-4567');
    assertContains(multi, '[email]');
    assertContains(multi, '[phone]');
  });
}

function testSecuritySanitize() {
  return test('Security.sanitize prevents formula injection', () => {
    // Dangerous prefixes should be escaped
    assert(Security.sanitize('=SUM(A1)').startsWith("'"), '= should be escaped');
    assert(Security.sanitize('+1234').startsWith("'"), '+ should be escaped');
    assert(Security.sanitize('-DELETE').startsWith("'"), '- should be escaped');
    assert(Security.sanitize('@mention').startsWith("'"), '@ should be escaped');
    
    // Normal text unchanged
    assertEqual(Security.sanitize('Normal text'), 'Normal text');
    assertEqual(Security.sanitize('Hello World'), 'Hello World');
    
    // Empty/null handling
    assertEqual(Security.sanitize(''), '—');
    assertEqual(Security.sanitize('   '), '—');
    assertEqual(Security.sanitize(null), '—');
    assertEqual(Security.sanitize(undefined), '—');
  });
}

function testSecurityValidateAIResponse() {
  return test('Security.validateAIResponse checks structure', () => {
    // Valid response
    const valid = [
      { category: 'JOB', isJob: true, play: 'Test', draft: 'Draft' },
      { category: 'NETWORKING', isJob: false, play: 'Test', draft: '' },
    ];
    assert(Security.validateAIResponse(valid, 2), 'Should accept valid response');
    
    // Wrong length
    assert(!Security.validateAIResponse(valid, 3), 'Should reject wrong length');
    
    // Invalid category
    const badCategory = [{ category: 'INVALID', isJob: true, play: 'Test', draft: '' }];
    assert(!Security.validateAIResponse(badCategory, 1), 'Should reject invalid category');
    
    // Missing fields
    const missingField = [{ category: 'JOB', isJob: true }];
    assert(!Security.validateAIResponse(missingField, 1), 'Should reject missing fields');
    
    // Not an array
    assert(!Security.validateAIResponse({}, 1), 'Should reject non-array');
    assert(!Security.validateAIResponse(null, 1), 'Should reject null');
  });
}

function testEmailExtractDomain() {
  return test('Email.extractDomain parses email addresses', () => {
    assertEqual(Email.extractDomain('kevin@figma.com'), 'figma.com');
    assertEqual(Email.extractDomain('"Kevin Chen" <kevin@figma.com>'), 'figma.com');
    assertEqual(Email.extractDomain('test.user@sub.domain.co.uk'), 'sub.domain.co.uk');
    assertEqual(Email.extractDomain('no-at-sign'), '');
    assertEqual(Email.extractDomain(''), '');
  });
}

function testEmailExtractName() {
  return test('Email.extractName parses contact names', () => {
    // Quoted name
    assertEqual(Email.extractName('"Kevin Chen" <kevin@figma.com>'), 'Kevin');
    
    // Email only
    assertEqual(Email.extractName('kevin@figma.com'), 'Kevin');
    assertEqual(Email.extractName('kevin.chen@figma.com'), 'Kevin');
    assertEqual(Email.extractName('kevin_chen@figma.com'), 'Kevin');
    
    // Handles lowercase
    assertEqual(Email.extractName('KEVIN@test.com'), 'Kevin');
  });
}

function testEmailDomainToCompany() {
  return test('Email.domainToCompany extracts company name', () => {
    assertEqual(Email.domainToCompany('figma.com'), 'figma');
    assertEqual(Email.domainToCompany('stripe.io'), 'stripe');
    assertEqual(Email.domainToCompany('company.co.uk'), 'co'); // Limitation
    assertEqual(Email.domainToCompany(''), 'direct');
  });
}

function testEmailCleanBody() {
  return test('Email.cleanBody removes noise and PII', () => {
    // Removes quoted replies
    const withQuote = 'My response\n\nOn Jan 1, John wrote:\n> Original message';
    assertNotContains(Email.cleanBody(withQuote), 'Original message');
    
    // Removes signatures
    const withSig = 'Main content\n\n--\nJohn Doe\nCEO';
    assertNotContains(Email.cleanBody(withSig), 'CEO');
    
    // Strips PII
    const withPII = 'Contact me at john@test.com or 555-123-4567';
    assertContains(Email.cleanBody(withPII), '[email]');
    assertContains(Email.cleanBody(withPII), '[phone]');
    
    // Truncates
    const long = 'x'.repeat(500);
    assert(Email.cleanBody(long, 100).length <= 100, 'Should truncate');
  });
}

function testStatusCompute() {
  return test('Status.compute returns correct priorities', () => {
    // Reply Needed (they replied, highest priority)
    const reply = Status.compute({ fromMe: false, days: 2, category: 'JOB' });
    assertEqual(reply.status.label, 'Reply Needed');
    assertEqual(reply.status.priority, 0);
    
    // Follow Up (you sent, stale)
    const followUp = Status.compute({ fromMe: true, days: 8, category: 'JOB' });
    assertEqual(followUp.status.label, 'Follow Up');
    assertEqual(followUp.status.priority, 1);
    
    // Waiting (you sent recently)
    const waiting = Status.compute({ fromMe: true, days: 2, category: 'JOB' });
    assertEqual(waiting.status.label, 'Waiting');
    assertEqual(waiting.status.priority, 2);
    
    // OTHER category gets Done status
    const other = Status.compute({ fromMe: true, days: 2, category: 'OTHER' });
    assertEqual(other.status.label, 'Done');
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

function testCacheLoadSave() {
  return test('Cache.load and Cache.save work correctly', () => {
    // Reset
    MockSpreadsheet.reset();
    Cache._data = null;
    Cache._sheet = null;
    
    // Create mock cache sheet
    const cacheSheet = MockSpreadsheet.insertSheet('_cache');
    cacheSheet._setData(1, 1, [CORE.CACHE_HEADERS]);
    cacheSheet._setData(2, 1, [
      ['thread1', 2, 'JOB', true, 'Test play', 'Test draft', '2024-01-01'],
    ]);
    cacheSheet._lastRow = 2;
    
    // Load
    const cache = Cache.load(MockSpreadsheet);
    assert(cache.size === 1, 'Should load 1 entry');
    
    const entry = cache.get('thread1');
    assert(entry !== null, 'Should find thread1');
    assertEqual(entry.category, 'JOB');
    assertEqual(entry.messageCount, 2);
    assertEqual(entry.play, 'Test play');
  });
}

function testCacheIsDirty() {
  return test('Cache.isDirty detects changes', () => {
    const row = { messageCount: 3 };
    
    // No cache = dirty
    assert(Cache.isDirty(row, null), 'Should be dirty if no cache');
    
    // Same message count = not dirty
    assert(!Cache.isDirty(row, { messageCount: 3 }), 'Should not be dirty if same count');
    
    // Different message count = dirty
    assert(Cache.isDirty(row, { messageCount: 2 }), 'Should be dirty if count changed');
  });
}

function testAIFallbackClassify() {
  return test('AI.fallbackClassify uses keyword patterns', () => {
    const rows = [
      { subject: 'Interview scheduled', company: 'google', snippet: 'coding interview', fromMe: false, days: 2 },
      { subject: 'Coffee chat', company: 'friend', snippet: 'catch up next week', fromMe: true, days: 8 },
      { subject: 'Your order shipped', company: 'amazon', snippet: 'package on way', fromMe: false, days: 1 },
    ];
    
    AI.fallbackClassify(rows);
    
    assertEqual(rows[0].category, 'JOB', 'Interview should be JOB');
    assertEqual(rows[0].isJob, true);
    
    assertEqual(rows[1].category, 'NETWORKING', 'Coffee should be NETWORKING');
    assertEqual(rows[1].isJob, false);
    
    assertEqual(rows[2].category, 'OTHER', 'Order should be OTHER');
    assertEqual(rows[2].isJob, false);
  });
}

function testHooksPreClassify() {
  return test('Hooks.preClassify respects domain overrides', () => {
    // Save original config
    const originalForce = USER_CONFIG.FORCE_JOB_DOMAINS;
    const originalIgnore = USER_CONFIG.IGNORE_DOMAINS;
    
    try {
      USER_CONFIG.FORCE_JOB_DOMAINS = ['google.com'];
      USER_CONFIG.IGNORE_DOMAINS = ['newsletter.com'];
      
      // Force job
      const forced = Hooks.preClassify({ domain: 'google.com' });
      assert(forced !== null, 'Should return override');
      assertEqual(forced.category, 'JOB');
      assertEqual(forced.isJob, true);
      
      // Ignore
      const ignored = Hooks.preClassify({ domain: 'newsletter.com' });
      assert(ignored !== null, 'Should return override');
      assertEqual(ignored.category, 'OTHER');
      assertEqual(ignored.isJob, false);
      
      // Normal
      const normal = Hooks.preClassify({ domain: 'figma.com' });
      assert(normal === null, 'Should return null for normal domains');
      
    } finally {
      // Restore
      USER_CONFIG.FORCE_JOB_DOMAINS = originalForce;
      USER_CONFIG.IGNORE_DOMAINS = originalIgnore;
    }
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// PROMPT TESTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Test prompt output quality (run manually with real API)
 * 
 * Usage:
 *   1. Set GROQ_KEY in Script Properties
 *   2. Run: testPromptQuality()
 *   3. Review output in execution log
 */
function testPromptQuality() {
  console.log('🧪 Testing Prompt Quality\n');
  
  const testCases = [
    {
      name: 'Reply Needed - Scheduling',
      input: {
        status: 'Reply Needed',
        company: 'stripe',
        contact: 'Maya',
        days: 2,
        subject: 'Re: PM Role Discussion',
        snippet: 'Thanks for your interest! Can you share your availability for a call next week?',
      },
      expect: {
        category: 'JOB',
        playContains: ['time', 'slot', 'availability'],
        draftMaxLength: 280,
      },
    },
    {
      name: 'Follow Up - Cold outreach',
      input: {
        status: 'Follow Up',
        company: 'figma',
        contact: 'Kevin',
        days: 8,
        subject: 'EM Role - Infrastructure',
        snippet: 'Hi Kevin, reaching out about the EM role. Built billing systems at scale.',
      },
      expect: {
        category: 'JOB',
        playNotContains: ['just following up', 'circling back'],
        draftMaxLength: 280,
      },
    },
    {
      name: 'Waiting - Recent send',
      input: {
        status: 'Waiting',
        company: 'google',
        contact: 'Sarah',
        days: 2,
        subject: 'Interview confirmation',
        snippet: 'Confirmed for Thursday at 2pm PT.',
      },
      expect: {
        category: 'JOB',
        playEquals: '—',
        draftEquals: '',
      },
    },
    {
      name: 'Networking - Alumni',
      input: {
        status: 'Follow Up',
        company: 'mckinsey',
        contact: 'James',
        days: 10,
        subject: 'CBS Alumni Connect',
        snippet: 'Great to chat! Let me know if I can help with your recruiting.',
      },
      expect: {
        category: 'NETWORKING',
        playContains: ['ask', 'intro', 'specific'],
        draftMaxLength: 280,
      },
    },
  ];
  
  const threadData = testCases.map(tc => tc.input);
  const prompt = PROMPTS.classifyAndPlay
    .replace('${threadData}', JSON.stringify(threadData, null, 2))
    .replace('${today}', new Date().toLocaleDateString());
  
  console.log('Prompt length:', prompt.length, 'chars\n');
  
  const result = AI.call(prompt);
  
  if (!result) {
    console.log('❌ AI call failed');
    return;
  }
  
  console.log('Results:\n');
  
  testCases.forEach((tc, i) => {
    const output = result[i];
    console.log(`${i + 1}. ${tc.name}`);
    console.log(`   Category: ${output.category} (expected: ${tc.expect.category})`);
    console.log(`   Play: "${output.play}"`);
    console.log(`   Draft: "${output.draft}" (${output.draft.length} chars)`);
    
    // Validate
    const issues = [];
    
    if (output.category !== tc.expect.category) {
      issues.push(`Wrong category: got ${output.category}`);
    }
    
    if (tc.expect.playEquals && output.play !== tc.expect.playEquals) {
      issues.push(`Play should be "${tc.expect.playEquals}"`);
    }
    
    if (tc.expect.playContains) {
      const playLower = output.play.toLowerCase();
      const missing = tc.expect.playContains.filter(word => !playLower.includes(word));
      if (missing.length) {
        issues.push(`Play missing: ${missing.join(', ')}`);
      }
    }
    
    if (tc.expect.playNotContains) {
      const playLower = output.play.toLowerCase();
      const found = tc.expect.playNotContains.filter(word => playLower.includes(word));
      if (found.length) {
        issues.push(`Play should not contain: ${found.join(', ')}`);
      }
    }
    
    if (tc.expect.draftMaxLength && output.draft.length > tc.expect.draftMaxLength) {
      issues.push(`Draft too long: ${output.draft.length} > ${tc.expect.draftMaxLength}`);
    }
    
    if (tc.expect.draftEquals !== undefined && output.draft !== tc.expect.draftEquals) {
      issues.push(`Draft should be "${tc.expect.draftEquals}"`);
    }
    
    if (issues.length) {
      console.log(`   ⚠️ Issues: ${issues.join('; ')}`);
    } else {
      console.log(`   ✅ Passed`);
    }
    
    console.log('');
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// SMOKE TEST (Quick validation with real APIs)
// ═══════════════════════════════════════════════════════════════════════════════

function smokeTest() {
  console.log('🔥 SMOKE TEST\n');
  
  const checks = [];
  
  // 1. Spreadsheet access
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    checks.push({ name: 'Spreadsheet access', pass: true, detail: ss.getName() });
  } catch (e) {
    checks.push({ name: 'Spreadsheet access', pass: false, detail: e.message });
  }
  
  // 2. Gmail access
  try {
    const threads = GmailApp.search('in:sent', 0, 1);
    checks.push({ name: 'Gmail access', pass: true, detail: `${threads.length} thread(s)` });
  } catch (e) {
    checks.push({ name: 'Gmail access', pass: false, detail: e.message });
  }
  
  // 3. API key present
  const props = PropertiesService.getScriptProperties().getProperties();
  const hasKey = Object.keys(props).some(k => k.includes('_KEY'));
  checks.push({ name: 'API key configured', pass: hasKey, detail: hasKey ? 'Found' : 'Missing' });
  
  // 4. Cache sheet
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cache = ss.getSheetByName('_cache');
    checks.push({ name: 'Cache sheet', pass: !!cache, detail: cache ? 'Exists' : 'Missing (run Setup)' });
  } catch (e) {
    checks.push({ name: 'Cache sheet', pass: false, detail: e.message });
  }
  
  // Report
  console.log('Results:');
  checks.forEach(c => {
    console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}: ${c.detail}`);
  });
  
  const allPass = checks.every(c => c.pass);
  console.log(`\n${allPass ? '✅ Ready to sync!' : '⚠️ Fix issues above first'}`);
  
  return allPass;
}
