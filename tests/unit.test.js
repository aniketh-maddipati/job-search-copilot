/**
 * Local Unit Tests for Job Co-Pilot
 * 
 * Run: npm test
 * 
 * Only tests pure logic - no Google API dependencies.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// COPY MODULES FROM Code.js (pure logic only)
// ═══════════════════════════════════════════════════════════════════════════════

// CONFIG (copied from Code.js)
const USER_CONFIG = {
    FOLLOWUP_DAYS: 5
  };
  
  const CORE = {
    UI: {
      COLORS: {
        replyNeeded: { bg: '#fce8e6', fg: '#c5221f' },
        followUp: { bg: '#fef7e0', fg: '#e37400' },
        waiting: { bg: '#e8f0fe', fg: '#1967d2' },
      }
    }
  };
  
  // STATUS (copied from Code.js)
  const Status = {
    compute(row) {
      if (!row.fromMe) return { label: 'Reply Needed', ...CORE.UI.COLORS.replyNeeded };
      if (row.days >= USER_CONFIG.FOLLOWUP_DAYS) return { label: 'Follow Up', ...CORE.UI.COLORS.followUp };
      return { label: 'Waiting', ...CORE.UI.COLORS.waiting };
    }
  };
  
  // SECURITY (copied from Code.js)
  const Security = {
    stripPII: (s) => !s ? '' : s.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]').replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone]'),
    sanitize: (s) => {
      if (typeof s !== 'string' || !s.trim()) return '—';
      return /^[=+\-@]/.test(s.trim()) ? "'" + s : s;
    }
  };
  
  // AI FALLBACK (copied from Code.js)
  const AI = {
    fallback(r, reason) {
      r.category = 'JOB';
      r.isJob = true;
      r.draft = '';
      
      switch (reason) {
        case 'no_key':
          r.play = '⚠️ Add API key in Setup';
          break;
        case 'auth':
          r.play = '⚠️ Invalid API key';
          break;
        case 'rate_limit':
          r.play = '⚠️ Rate limited - try again later';
          break;
        case 'network':
          r.play = '⚠️ Network error - check connection';
          break;
        default:
          r.play = '⚠️ AI unavailable - sync again';
      }
    }
  };
  // ═══════════════════════════════════════════════════════════════════════════════
  // TESTS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  describe('Status.compute', () => {
    test('returns Reply Needed when not fromMe', () => {
      const row = { fromMe: false, days: 1 };
      const result = Status.compute(row);
      expect(result.label).toBe('Reply Needed');
    });
  
    test('returns Reply Needed even at 0 days', () => {
      const row = { fromMe: false, days: 0 };
      const result = Status.compute(row);
      expect(result.label).toBe('Reply Needed');
    });
  
    test('returns Follow Up when fromMe and exactly 5 days', () => {
      const row = { fromMe: true, days: 5 };
      const result = Status.compute(row);
      expect(result.label).toBe('Follow Up');
    });
  
    test('returns Follow Up when fromMe and 10 days', () => {
      const row = { fromMe: true, days: 10 };
      const result = Status.compute(row);
      expect(result.label).toBe('Follow Up');
    });
  
    test('returns Waiting when fromMe and 4 days', () => {
      const row = { fromMe: true, days: 4 };
      const result = Status.compute(row);
      expect(result.label).toBe('Waiting');
    });
  
    test('returns Waiting when fromMe and 0 days', () => {
      const row = { fromMe: true, days: 0 };
      const result = Status.compute(row);
      expect(result.label).toBe('Waiting');
    });

    
  });
  
  describe('Security.stripPII', () => {
    test('strips email addresses', () => {
      const input = 'Contact john@example.com for info';
      const result = Security.stripPII(input);
      expect(result).not.toContain('john@example.com');
      expect(result).toContain('[email]');
    });
  
    test('strips multiple emails', () => {
      const input = 'From: a@b.com To: c@d.com';
      const result = Security.stripPII(input);
      expect(result).toBe('From: [email] To: [email]');
    });
  
    test('strips phone numbers with dashes', () => {
      const input = 'Call 555-123-4567';
      const result = Security.stripPII(input);
      expect(result).not.toContain('555-123-4567');
      expect(result).toContain('[phone]');
    });
  
    test('strips phone numbers with dots', () => {
      const input = 'Call 555.123.4567';
      const result = Security.stripPII(input);
      expect(result).toContain('[phone]');
    });
  
    test('handles empty string', () => {
      expect(Security.stripPII('')).toBe('');
    });
  
    test('handles null', () => {
      expect(Security.stripPII(null)).toBe('');
    });
  });
  
  describe('Security.sanitize', () => {
    test('escapes formula starting with =', () => {
      const result = Security.sanitize('=SUM(A1)');
      expect(result.startsWith("'")).toBe(true);
    });
  
    test('escapes formula starting with +', () => {
      const result = Security.sanitize('+1234');
      expect(result.startsWith("'")).toBe(true);
    });
  
    test('escapes formula starting with -', () => {
      const result = Security.sanitize('-1234');
      expect(result.startsWith("'")).toBe(true);
    });
  
    test('escapes formula starting with @', () => {
      const result = Security.sanitize('@mention');
      expect(result.startsWith("'")).toBe(true);
    });
  
    test('returns dash for empty string', () => {
      expect(Security.sanitize('')).toBe('—');
    });
  
    test('returns dash for whitespace', () => {
      expect(Security.sanitize('   ')).toBe('—');
    });
  
    test('returns dash for null', () => {
      expect(Security.sanitize(null)).toBe('—');
    });
  
    test('passes through normal text', () => {
      expect(Security.sanitize('Hello world')).toBe('Hello world');
    });
  });
  
  describe('AI.fallback', () => {
    test('sets category to JOB', () => {
      const row = {};
      AI.fallback(row, 'error');
      expect(row.category).toBe('JOB');
    });
  
    test('sets isJob to true', () => {
      const row = {};
      AI.fallback(row, 'error');
      expect(row.isJob).toBe(true);
    });
  
    test('sets draft to empty string', () => {
      const row = {};
      AI.fallback(row, 'error');
      expect(row.draft).toBe('');
    });
  
    test('shows no_key message', () => {
      const row = {};
      AI.fallback(row, 'no_key');
      expect(row.play).toContain('Add API key');
    });
  
    test('shows auth error message', () => {
      const row = {};
      AI.fallback(row, 'auth');
      expect(row.play).toContain('Invalid API key');
    });
  
    test('shows rate limit message', () => {
      const row = {};
      AI.fallback(row, 'rate_limit');
      expect(row.play).toContain('Rate limited');
    });
  
    test('shows network error message', () => {
      const row = {};
      AI.fallback(row, 'network');
      expect(row.play).toContain('Network error');
    });
  
    test('shows generic message for unknown reason', () => {
      const row = {};
      AI.fallback(row, 'unknown');
      expect(row.play).toContain('AI unavailable - sync again');
    });
    
  });

  // ═══════════════════════════════════════════════════════════════════════════════
// AI RESPONSE PARSING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: Simulates extracting JSON array from LLM response
function extractJsonArray(content) {
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  
  // Helper: Simulates applying results to rows
  function applyResults(rows, results) {
    let applied = 0;
    rows.forEach((r, i) => {
      if (results && results[i]) {
        r.category = results[i].category || 'JOB';
        r.isJob = results[i].isJob !== false;
        r.play = results[i].play || '—';
        r.draft = results[i].draft || '';
        applied++;
      } else {
        // fallback
        r.category = 'JOB';
        r.isJob = true;
        r.play = '—';
        r.draft = '';
      }
    });
    return applied;
  }
  
  describe('AI Response Parsing', () => {
    
    describe('extractJsonArray', () => {
      test('extracts valid JSON array', () => {
        const content = '[{"category":"JOB","isJob":true,"play":"Test","draft":"Hi"}]';
        const result = extractJsonArray(content);
        expect(result).toEqual([{ category: 'JOB', isJob: true, play: 'Test', draft: 'Hi' }]);
      });
  
      test('extracts JSON array with surrounding text', () => {
        const content = 'Here is the result:\n[{"category":"JOB"}]\nDone.';
        const result = extractJsonArray(content);
        expect(result).toEqual([{ category: 'JOB' }]);
      });
  
      test('extracts multiline JSON array', () => {
        const content = `[
          {"category": "JOB", "play": "Follow up"},
          {"category": "NETWORKING", "play": "Send thanks"}
        ]`;
        const result = extractJsonArray(content);
        expect(result).toHaveLength(2);
        expect(result[0].category).toBe('JOB');
        expect(result[1].category).toBe('NETWORKING');
      });
  
      test('returns null for no array', () => {
        const content = 'I cannot process this request.';
        const result = extractJsonArray(content);
        expect(result).toBeNull();
      });
  
      test('returns null for invalid JSON', () => {
        const content = '[{invalid json}]';
        const result = extractJsonArray(content);
        expect(result).toBeNull();
      });
  
      test('returns null for empty content', () => {
        expect(extractJsonArray('')).toBeNull();
      });
    });
  
    describe('applyResults', () => {
      test('applies all results when counts match', () => {
        const rows = [{}, {}, {}];
        const results = [
          { category: 'JOB', isJob: true, play: 'Follow up', draft: 'Hi there' },
          { category: 'NETWORKING', isJob: false, play: 'Send thanks', draft: 'Thanks!' },
          { category: 'OTHER', isJob: false, play: '—', draft: '' }
        ];
        
        const applied = applyResults(rows, results);
        
        expect(applied).toBe(3);
        expect(rows[0].category).toBe('JOB');
        expect(rows[0].play).toBe('Follow up');
        expect(rows[1].category).toBe('NETWORKING');
        expect(rows[2].category).toBe('OTHER');
      });
  
      test('uses fallback for missing results', () => {
        const rows = [{}, {}, {}];
        const results = [
          { category: 'JOB', play: 'Test' }
          // Missing results for rows 1 and 2
        ];
        
        const applied = applyResults(rows, results);
        
        expect(applied).toBe(1);
        expect(rows[0].category).toBe('JOB');
        expect(rows[1].category).toBe('JOB'); // fallback
        expect(rows[1].play).toBe('—');       // fallback
        expect(rows[2].category).toBe('JOB'); // fallback
      });
  
      test('uses fallback when results is null', () => {
        const rows = [{}, {}];
        const applied = applyResults(rows, null);
        
        expect(applied).toBe(0);
        expect(rows[0].category).toBe('JOB');
        expect(rows[0].play).toBe('—');
      });
  
      test('handles missing fields with defaults', () => {
        const rows = [{}];
        const results = [{ category: 'NETWORKING' }]; // missing isJob, play, draft
        
        applyResults(rows, results);
        
        expect(rows[0].category).toBe('NETWORKING');
        expect(rows[0].isJob).toBe(true);  // default: not false
        expect(rows[0].play).toBe('—');    // default
        expect(rows[0].draft).toBe('');    // default
      });
  
      test('isJob false is preserved', () => {
        const rows = [{}];
        const results = [{ category: 'OTHER', isJob: false, play: 'Skip', draft: '' }];
        
        applyResults(rows, results);
        
        expect(rows[0].isJob).toBe(false);
      });
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // HTTP STATUS CODE HANDLING TESTS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  describe('HTTP Status Handling', () => {
    
    // Simulates what AI.classifyAndPlay does with status codes
    function handleHttpStatus(code) {
      if (code === 401) return { success: false, reason: 'auth' };
      if (code === 429) return { success: false, reason: 'rate_limit' };
      if (code !== 200) return { success: false, reason: 'http_error', code };
      return { success: true };
    }
  
    test('401 returns auth error', () => {
      const result = handleHttpStatus(401);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('auth');
    });
  
    test('429 returns rate_limit error', () => {
      const result = handleHttpStatus(429);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('rate_limit');
    });
  
    test('500 returns http_error', () => {
      const result = handleHttpStatus(500);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('http_error');
      expect(result.code).toBe(500);
    });
  
    test('503 returns http_error', () => {
      const result = handleHttpStatus(503);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('http_error');
    });
  
    test('200 returns success', () => {
      const result = handleHttpStatus(200);
      expect(result.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
// SYNC FRESH LOGIC TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('syncFresh logic', () => {
  
    // Simulates the decision: should we clear cache?
    function shouldClearCache(cacheRowCount) {
      return cacheRowCount > 0;
    }
    
    test('clears cache when rows exist', () => {
      expect(shouldClearCache(50)).toBe(true);
      expect(shouldClearCache(1)).toBe(true);
    });
    
    test('skips clear when cache empty', () => {
      expect(shouldClearCache(0)).toBe(false);
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // CACHE VERSION LOGIC TESTS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  describe('Cache versioning logic', () => {
    
    const CURRENT_VERSION = 1;
    
    // Simulates: should we invalidate cache based on version?
    function shouldInvalidateCache(storedVersion, currentVersion) {
      return storedVersion < currentVersion;
    }
    
    test('invalidates when stored version is older', () => {
      expect(shouldInvalidateCache(0, 1)).toBe(true);
      expect(shouldInvalidateCache(1, 2)).toBe(true);
      expect(shouldInvalidateCache(5, 10)).toBe(true);
    });
    
    test('keeps cache when version matches', () => {
      expect(shouldInvalidateCache(1, 1)).toBe(false);
      expect(shouldInvalidateCache(5, 5)).toBe(false);
    });
    
    test('keeps cache when stored version is newer (edge case)', () => {
      // Shouldn't happen, but shouldn't break
      expect(shouldInvalidateCache(2, 1)).toBe(false);
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // MENU ACTION TESTS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  describe('Menu actions', () => {
    
    // Simulates which sync function to call
    function getSyncAction(menuChoice) {
      const actions = {
        'sync': { clearCache: false, name: 'sync' },
        'syncFresh': { clearCache: true, name: 'syncFresh' },
      };
      return actions[menuChoice] || null;
    }
    
    test('Sync Now does not clear cache', () => {
      const action = getSyncAction('sync');
      expect(action.clearCache).toBe(false);
    });
    
    test('Sync Fresh clears cache', () => {
      const action = getSyncAction('syncFresh');
      expect(action.clearCache).toBe(true);
    });
    
    test('unknown action returns null', () => {
      expect(getSyncAction('invalid')).toBeNull();
    });
  });

 // ═══════════════════════════════════════════════════════════════════════════════
// BATCHING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Batching logic', () => {
  
    function createBatches(items, batchSize) {
      const batches = [];
      for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
      }
      return batches;
    }
    
    test('50 items → 5 batches of 10', () => {
      const items = Array(50).fill('x');
      const batches = createBatches(items, 10);
      expect(batches.length).toBe(5);
      expect(batches[0].length).toBe(10);
      expect(batches[4].length).toBe(10);
    });
    
    test('23 items → 3 batches (10, 10, 3)', () => {
      const items = Array(23).fill('x');
      const batches = createBatches(items, 10);
      expect(batches.length).toBe(3);
      expect(batches[0].length).toBe(10);
      expect(batches[1].length).toBe(10);
      expect(batches[2].length).toBe(3);
    });
    
    test('5 items → 1 batch of 5', () => {
      const items = Array(5).fill('x');
      const batches = createBatches(items, 10);
      expect(batches.length).toBe(1);
      expect(batches[0].length).toBe(5);
    });
    
    test('0 items → 0 batches', () => {
      const batches = createBatches([], 10);
      expect(batches.length).toBe(0);
    });
    
    test('exact batch size → no partial batch', () => {
      const items = Array(20).fill('x');
      const batches = createBatches(items, 10);
      expect(batches.length).toBe(2);
      expect(batches[0].length).toBe(10);
      expect(batches[1].length).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
// SHEET CLEANUP TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sheet cleanup logic', () => {
  
    function shouldDeleteSheet(sheetName, lastRow) {
      return sheetName === 'Sheet1' && lastRow === 0;
    }
    
    test('deletes empty Sheet1', () => {
      expect(shouldDeleteSheet('Sheet1', 0)).toBe(true);
    });
    
    test('keeps Sheet1 with data', () => {
      expect(shouldDeleteSheet('Sheet1', 1)).toBe(false);
      expect(shouldDeleteSheet('Sheet1', 10)).toBe(false);
    });
    
    test('keeps other empty sheets', () => {
      expect(shouldDeleteSheet('Dashboard', 0)).toBe(false);
      expect(shouldDeleteSheet('_cache', 0)).toBe(false);
    });
  });