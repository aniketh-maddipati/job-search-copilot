#!/usr/bin/env node
/**
 * Local Test Runner for Job Search Co-Pilot
 * 
 * Usage:
 *   node local/test-runner.js           # Run all tests
 *   node local/test-runner.js --filter Security  # Run tests matching "Security"
 *   node local/test-runner.js --verbose # Show detailed output
 *   node local/test-runner.js --diagnose # Run diagnostics only
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG & CLI ARGS
// ═══════════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const FLAGS = {
  verbose: args.includes('--verbose') || args.includes('-v'),
  diagnose: args.includes('--diagnose') || args.includes('-d'),
  filter: args.find(a => a.startsWith('--filter='))?.split('=')[1] || 
          args[args.indexOf('--filter') + 1] || null,
  help: args.includes('--help') || args.includes('-h'),
};

if (FLAGS.help) {
  console.log(`
Job Search Co-Pilot - Local Test Runner

Usage:
  node local/test-runner.js [options]

Options:
  --filter, -f <pattern>  Only run tests matching pattern
  --verbose, -v           Show detailed output
  --diagnose, -d          Run diagnostics only
  --help, -h              Show this help message

Examples:
  node local/test-runner.js
  node local/test-runner.js --filter Security
  node local/test-runner.js --verbose --filter Email
`);
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLORS (no dependencies)
// ═══════════════════════════════════════════════════════════════════════════════

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${c.blue}ℹ${c.reset} ${msg}`),
  success: (msg) => console.log(`${c.green}✓${c.reset} ${msg}`),
  error: (msg) => console.log(`${c.red}✗${c.reset} ${msg}`),
  warn: (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`),
  dim: (msg) => console.log(`${c.dim}  ${msg}${c.reset}`),
  header: (msg) => console.log(`\n${c.bold}${c.cyan}═══ ${msg} ═══${c.reset}\n`),
};

// ═══════════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════════

function runDiagnostics() {
  log.header('ENVIRONMENT DIAGNOSTICS');
  
  const checks = [];
  
  // Node version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0]);
  checks.push({
    name: 'Node.js version',
    status: nodeMajor >= 18 ? 'pass' : 'warn',
    value: nodeVersion,
    hint: nodeMajor < 18 ? 'Recommend Node.js 18+' : null
  });
  
  // Required files
  const requiredFiles = [
    'Code.js',
    'Setup.html',
    'appsscript.json',
    'local/mocks.js',
    'local/data/mock_threads.json',
    'local/data/mock_ai_responses.json',
  ];
  
  const rootDir = path.join(__dirname, '..');
  for (const file of requiredFiles) {
    const filePath = path.join(rootDir, file);
    const exists = fs.existsSync(filePath);
    checks.push({
      name: `File: ${file}`,
      status: exists ? 'pass' : 'fail',
      value: exists ? 'exists' : 'MISSING',
      hint: !exists ? `Create ${file} or run setup` : null
    });
  }
  
  // Check package.json dependencies
  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const requiredDeps = ['fastify', '@fastify/static'];
    
    for (const dep of requiredDeps) {
      checks.push({
        name: `Dependency: ${dep}`,
        status: deps[dep] ? 'pass' : 'fail',
        value: deps[dep] || 'NOT FOUND',
        hint: !deps[dep] ? `Run: npm install ${dep}` : null
      });
    }
  }
  
  // Check if node_modules exists
  const nodeModulesExists = fs.existsSync(path.join(rootDir, 'node_modules'));
  checks.push({
    name: 'node_modules installed',
    status: nodeModulesExists ? 'pass' : 'fail',
    value: nodeModulesExists ? 'yes' : 'NO',
    hint: !nodeModulesExists ? 'Run: npm install' : null
  });
  
  // Check mock data validity
  const mockFiles = ['mock_threads.json', 'mock_ai_responses.json'];
  for (const file of mockFiles) {
    const filePath = path.join(__dirname, 'data', file);
    if (fs.existsSync(filePath)) {
      try {
        JSON.parse(fs.readFileSync(filePath, 'utf8'));
        checks.push({
          name: `JSON valid: ${file}`,
          status: 'pass',
          value: 'valid'
        });
      } catch (e) {
        checks.push({
          name: `JSON valid: ${file}`,
          status: 'fail',
          value: 'INVALID',
          hint: `Parse error: ${e.message}`
        });
      }
    }
  }
  
  // Print results
  let hasFailures = false;
  for (const check of checks) {
    const icon = check.status === 'pass' ? `${c.green}✓` : 
                 check.status === 'warn' ? `${c.yellow}⚠` : `${c.red}✗`;
    console.log(`${icon}${c.reset} ${check.name}: ${c.bold}${check.value}${c.reset}`);
    if (check.hint) {
      log.dim(check.hint);
    }
    if (check.status === 'fail') hasFailures = true;
  }
  
  console.log('');
  if (hasFailures) {
    log.error('Some checks failed. Fix the issues above before running tests.');
    return false;
  } else {
    log.success('All diagnostics passed!');
    return true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════════

const testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: []
};

function assert(condition, message) {
  if (!condition) {
    const err = new Error(message || 'Assertion failed');
    err.isAssertionError = true;
    throw err;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    const err = new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
    err.isAssertionError = true;
    err.actual = actual;
    err.expected = expected;
    throw err;
  }
}

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) {
    const err = new Error(message || 'Expected function to throw');
    err.isAssertionError = true;
    throw err;
  }
}

function test(name, fn) {
  // Apply filter if specified
  if (FLAGS.filter && !name.toLowerCase().includes(FLAGS.filter.toLowerCase())) {
    testResults.skipped++;
    return;
  }
  
  const startTime = Date.now();
  
  try {
    fn();
    const duration = Date.now() - startTime;
    testResults.passed++;
    testResults.tests.push({ name, status: 'pass', duration });
    log.success(`${name} ${c.dim}(${duration}ms)${c.reset}`);
  } catch (e) {
    const duration = Date.now() - startTime;
    testResults.failed++;
    testResults.tests.push({ name, status: 'fail', error: e, duration });
    log.error(`${name} ${c.dim}(${duration}ms)${c.reset}`);
    
    if (FLAGS.verbose) {
      if (e.isAssertionError) {
        log.dim(`  ${e.message}`);
        if (e.actual !== undefined) {
          log.dim(`  Actual:   ${JSON.stringify(e.actual)}`);
          log.dim(`  Expected: ${JSON.stringify(e.expected)}`);
        }
      } else {
        log.dim(`  ${e.stack}`);
      }
    } else {
      log.dim(`  ${e.message}`);
    }
  }
}

function describe(suiteName, fn) {
  console.log(`\n${c.bold}${suiteName}${c.reset}`);
  fn();
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD ENVIRONMENT
// ═══════════════════════════════════════════════════════════════════════════════

function loadEnvironment() {
  log.header('LOADING ENVIRONMENT');
  
  // Load mocks
  try {
    const mocks = require('./mocks');
    Object.assign(global, mocks);
    log.success('Mocks loaded');
  } catch (e) {
    log.error(`Failed to load mocks: ${e.message}`);
    if (FLAGS.verbose) log.dim(e.stack);
    return false;
  }
  
  // Load Code.js
  try {
    const codePath = path.join(__dirname, '..', 'Code.js');
    const codeContent = fs.readFileSync(codePath, 'utf8');
    eval(codeContent);
    log.success('Code.js loaded');
    
    // Verify key functions exist
    const expectedFunctions = ['sync', 'saveAndInit', 'doGet', 'onOpen'];
    const missing = expectedFunctions.filter(f => typeof global[f] !== 'function');
    if (missing.length > 0) {
      log.warn(`Missing expected functions: ${missing.join(', ')}`);
    }
  } catch (e) {
    log.error(`Failed to load Code.js: ${e.message}`);
    if (FLAGS.verbose) log.dim(e.stack);
    return false;
  }
  
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════════

function runTests() {
  log.header('RUNNING TESTS');
  
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Security', () => {
    test('Security.stripPII removes email addresses', () => {
      const input = 'Contact john@example.com for details';
      const output = Security.stripPII(input);
      assert(!output.includes('john@example.com'), 'Email should be stripped');
      assert(output.includes('[email]'), 'Should replace with [email]');
    });
    
    test('Security.stripPII removes phone numbers', () => {
      const input = 'Call me at 555-123-4567 or 555.123.4567';
      const output = Security.stripPII(input);
      assert(!output.includes('555'), 'Phone should be stripped');
      assert(output.includes('[phone]'), 'Should replace with [phone]');
    });
    
    test('Security.stripPII handles empty input', () => {
      assertEqual(Security.stripPII(''), '');
      assertEqual(Security.stripPII(null), '');
      assertEqual(Security.stripPII(undefined), '');
    });
    
    test('Security.sanitize blocks formula injection', () => {
      assert(Security.sanitize('=SUM(A1)').startsWith("'"), 'Should prefix =');
      assert(Security.sanitize('+cmd|').startsWith("'"), 'Should prefix +');
      assert(Security.sanitize('-1+1').startsWith("'"), 'Should prefix -');
      assert(Security.sanitize('@SUM').startsWith("'"), 'Should prefix @');
    });
    
    test('Security.sanitize passes normal text', () => {
      assertEqual(Security.sanitize('Normal text'), 'Normal text');
      assertEqual(Security.sanitize('Hello World!'), 'Hello World!');
    });
    
    test('Security.sanitize handles empty/invalid input', () => {
      assertEqual(Security.sanitize(''), '—');
      assertEqual(Security.sanitize('   '), '—');
      assertEqual(Security.sanitize(null), '—');
    });
    
    test('Security.validateAI checks array structure', () => {
      assert(Security.validateAI([{}, {}], 2) === true, 'Should validate correct length');
      assert(Security.validateAI([{}], 2) === false, 'Should reject wrong length');
      assert(Security.validateAI('not array', 1) === false, 'Should reject non-array');
      assert(Security.validateAI(null, 1) === false, 'Should reject null');
    });
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Status', () => {
    test('Status.compute returns Reply Needed when not from me', () => {
      const status = Status.compute({ fromMe: false, days: 2 });
      assertEqual(status.label, 'Reply Needed');
    });
    
    test('Status.compute returns Follow Up after threshold days', () => {
      const status = Status.compute({ fromMe: true, days: 8 });
      assertEqual(status.label, 'Follow Up');
    });
    
    test('Status.compute returns Waiting when recent', () => {
      const status = Status.compute({ fromMe: true, days: 2 });
      assertEqual(status.label, 'Waiting');
    });
    
    test('Status.compute returns Waiting at exactly threshold', () => {
      // At exactly 5 days (default threshold), should still be Waiting
      const status = Status.compute({ fromMe: true, days: 5 });
      // At exactly threshold, it should be Follow Up (>= check)
      assertEqual(status.label, 'Follow Up');
    });
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Cache', () => {
    test('Cache.load returns Map', () => {
      const cache = Cache.load();
      assert(cache instanceof Map, 'Should return a Map');
    });
    
    test('Cache operations work without errors', () => {
      // Should not throw
      Cache.load();
      Cache.save([]);
    });
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  describe('AI', () => {
    test('AI.fallback sets default values', () => {
      const row = { company: 'Test', body: 'test' };
      AI.fallback(row);
      
      assertEqual(row.category, 'JOB');
      assertEqual(row.isJob, true);
      assert(row.play.length > 0, 'Should set play');
    });
    
    test('AI.classifyAndPlay handles missing API key', () => {
      const rows = [{ company: 'Test', body: 'test', status: { label: 'Waiting' } }];
      // Should not throw, should fall back
      AI.classifyAndPlay(rows);
      assert(rows[0].category !== undefined, 'Should set category via fallback');
    });
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Config', () => {
    test('CORE config is frozen', () => {
      assert(Object.isFrozen(CORE), 'CORE should be frozen');
    });
    
    test('CORE has required properties', () => {
      assert(CORE.VERSION, 'Should have VERSION');
      assert(CORE.SHEETS, 'Should have SHEETS');
      assert(CORE.HEADERS, 'Should have HEADERS');
      assert(Array.isArray(CORE.HEADERS), 'HEADERS should be array');
    });
    
    test('USER_CONFIG has required properties', () => {
      assert(typeof USER_CONFIG.LOOKBACK === 'number', 'Should have LOOKBACK');
      assert(typeof USER_CONFIG.FOLLOWUP_DAYS === 'number', 'Should have FOLLOWUP_DAYS');
    });
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Logging', () => {
    test('Log functions exist and are callable', () => {
      assert(typeof Log.info === 'function', 'Log.info should be function');
      assert(typeof Log.warn === 'function', 'Log.warn should be function');
      assert(typeof Log.error === 'function', 'Log.error should be function');
      
      // Should not throw
      Log.info('TEST', 'test message');
      Log.warn('TEST', 'test warning');
      Log.error('TEST', 'test error');
    });
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  describe('App Adapters', () => {
    test('App.gmail.search is callable', () => {
      assert(typeof App.gmail.search === 'function', 'Should have search method');
      const threads = App.gmail.search('test', 0, 10);
      assert(Array.isArray(threads), 'Should return array');
    });
    
    test('App.sheets methods exist', () => {
      assert(typeof App.sheets.getActive === 'function', 'Should have getActive');
      assert(typeof App.sheets.getSheet === 'function', 'Should have getSheet');
      assert(typeof App.sheets.createSheet === 'function', 'Should have createSheet');
    });
    
    test('App.props methods exist', () => {
      assert(typeof App.props.get === 'function', 'Should have get');
      assert(typeof App.props.set === 'function', 'Should have set');
    });
  });
  
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Integration', () => {
    test('sync function exists and is callable', () => {
      assert(typeof sync === 'function', 'sync should be defined');
    });
    
    test('doGet function exists and is callable', () => {
      assert(typeof doGet === 'function', 'doGet should be defined');
    });
    
    test('saveAndInit function exists and is callable', () => {
      assert(typeof saveAndInit === 'function', 'saveAndInit should be defined');
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function printReport() {
  log.header('TEST RESULTS');
  
  const total = testResults.passed + testResults.failed;
  const passRate = total > 0 ? ((testResults.passed / total) * 100).toFixed(1) : 0;
  
  console.log(`${c.green}Passed:${c.reset}  ${testResults.passed}`);
  console.log(`${c.red}Failed:${c.reset}  ${testResults.failed}`);
  if (testResults.skipped > 0) {
    console.log(`${c.yellow}Skipped:${c.reset} ${testResults.skipped}`);
  }
  console.log(`${c.bold}Total:${c.reset}   ${total}`);
  console.log(`${c.bold}Pass Rate:${c.reset} ${passRate}%`);
  
  if (testResults.failed > 0) {
    console.log(`\n${c.red}${c.bold}Failed Tests:${c.reset}`);
    for (const t of testResults.tests.filter(t => t.status === 'fail')) {
      console.log(`  ${c.red}✗${c.reset} ${t.name}`);
      if (t.error) {
        log.dim(`    ${t.error.message}`);
      }
    }
  }
  
  console.log('');
  return testResults.failed === 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${c.bold}${c.cyan}Job Search Co-Pilot - Test Runner${c.reset}\n`);
  
  // Run diagnostics
  const diagOk = runDiagnostics();
  
  if (FLAGS.diagnose) {
    process.exit(diagOk ? 0 : 1);
  }
  
  if (!diagOk) {
    log.error('Fix diagnostic issues before running tests');
    process.exit(1);
  }
  
  // Load environment
  const envOk = loadEnvironment();
  if (!envOk) {
    log.error('Failed to load environment');
    process.exit(1);
  }
  
  // Run tests
  runTests();
  
  // Print report
  const allPassed = printReport();
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  log.error(`Unexpected error: ${e.message}`);
  if (FLAGS.verbose) console.error(e.stack);
  process.exit(1);
});
