/**
 * Local Unit Tests for Job Co-Pilot v1.2.0
 *
 * Run: npm test
 */

// ═══════════════════════════════════════════════════════════════════════════════
// COPY MODULES FROM Code.js (pure logic only)
// ═══════════════════════════════════════════════════════════════════════════════

const USER_CONFIG = {
  FOLLOWUP_DAYS: 5,
  FINAL_CATEGORIES: ['Offer', 'Final Round', 'Contract'],
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

const Status = {
  compute(row) {
    if (!row.fromMe) return { label: 'Reply Needed', ...CORE.UI.COLORS.replyNeeded };
    if (row.days >= USER_CONFIG.FOLLOWUP_DAYS) return { label: 'Follow Up', ...CORE.UI.COLORS.followUp };
    return { label: 'Waiting', ...CORE.UI.COLORS.waiting };
  }
};

const Security = {
  stripPII: (s) => !s ? '' : s.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]').replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone]'),
  sanitize: (s) => {
    if (typeof s !== 'string' || !s.trim()) return '—';
    return /^[=+\-@]/.test(s.trim()) ? "'" + s : s;
  }
};

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
    if (p.to.includes(myEmail)) return { action: 'exclude', reason: 'self_send' };
    if (this.PERSONAL_DOMAINS.includes(p.domain)) return { action: 'exclude', reason: 'personal_domain' };
    if (this.TRANSACTIONAL.some(re => re.test(p.subject))) return { action: 'exclude', reason: 'transactional' };
    if (this.JOB_SIGNALS.some(re => re.test(p.subject))) return { action: 'include', reason: 'job_signal' };
    return { action: 'uncertain', reason: 'needs_llm' };
  }
};

const AI = {
  fallback(r, reason) {
    r.category = 'JOB';
    r.isJob = true;
    r.draft = '';
    const msgs = { no_key: '⚠️ Add API key', auth: '⚠️ Invalid key', rate_limit: '⚠️ Rate limited', all_failed: '⚠️ LLM failed' };
    r.play = msgs[reason] || '⚠️ Sync again';
  }
};

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
// TESTS: Status.compute
// ═══════════════════════════════════════════════════════════════════════════════

describe('Status.compute', () => {
  test('returns Reply Needed when not fromMe', () => {
    expect(Status.compute({ fromMe: false, days: 1 }).label).toBe('Reply Needed');
  });

  test('returns Follow Up when fromMe and >= 5 days', () => {
    expect(Status.compute({ fromMe: true, days: 5 }).label).toBe('Follow Up');
    expect(Status.compute({ fromMe: true, days: 10 }).label).toBe('Follow Up');
  });

  test('returns Waiting when fromMe and < 5 days', () => {
    expect(Status.compute({ fromMe: true, days: 4 }).label).toBe('Waiting');
    expect(Status.compute({ fromMe: true, days: 0 }).label).toBe('Waiting');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Security
// ═══════════════════════════════════════════════════════════════════════════════

describe('Security.stripPII', () => {
  test('strips emails', () => {
    expect(Security.stripPII('Contact john@example.com')).toContain('[email]');
  });

  test('strips phone numbers', () => {
    expect(Security.stripPII('Call 555-123-4567')).toContain('[phone]');
  });

  test('handles null/empty', () => {
    expect(Security.stripPII('')).toBe('');
    expect(Security.stripPII(null)).toBe('');
  });
});

describe('Security.sanitize', () => {
  test('escapes formulas', () => {
    expect(Security.sanitize('=SUM(A1)').startsWith("'")).toBe(true);
    expect(Security.sanitize('+1234').startsWith("'")).toBe(true);
    expect(Security.sanitize('-1234').startsWith("'")).toBe(true);
    expect(Security.sanitize('@mention').startsWith("'")).toBe(true);
  });

  test('returns dash for empty', () => {
    expect(Security.sanitize('')).toBe('—');
    expect(Security.sanitize(null)).toBe('—');
  });

  test('passes normal text', () => {
    expect(Security.sanitize('Hello')).toBe('Hello');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Filters
// ═══════════════════════════════════════════════════════════════════════════════

describe('Filters.classify', () => {
  const myEmail = 'me@example.com';

  test('excludes self-sends', () => {
    const result = Filters.classify({ to: 'me@example.com', domain: 'example', subject: 'Test' }, myEmail);
    expect(result.action).toBe('exclude');
    expect(result.reason).toBe('self_send');
  });

  test('excludes personal domains', () => {
    const result = Filters.classify({ to: 'friend@gmail.com', domain: 'gmail', subject: 'Hey' }, myEmail);
    expect(result.action).toBe('exclude');
    expect(result.reason).toBe('personal_domain');
  });

  test('excludes transactional', () => {
    const result = Filters.classify({ to: 'orders@amazon.com', domain: 'amazon', subject: 'Your order confirmation' }, myEmail);
    expect(result.action).toBe('exclude');
    expect(result.reason).toBe('transactional');
  });

  test('includes job signals', () => {
    const result = Filters.classify({ to: 'recruiter@stripe.com', domain: 'stripe', subject: 'SWE Interview' }, myEmail);
    expect(result.action).toBe('include');
    expect(result.reason).toBe('job_signal');
  });

  test('returns uncertain for ambiguous', () => {
    const result = Filters.classify({ to: 'contact@startup.com', domain: 'startup', subject: 'Quick question' }, myEmail);
    expect(result.action).toBe('uncertain');
    expect(result.reason).toBe('needs_llm');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: AI.fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI.fallback', () => {
  test('sets defaults', () => {
    const row = {};
    AI.fallback(row, 'error');
    expect(row.category).toBe('JOB');
    expect(row.isJob).toBe(true);
    expect(row.draft).toBe('');
  });

  test('shows appropriate messages', () => {
    let row = {}; AI.fallback(row, 'no_key'); expect(row.play).toContain('API key');
    row = {}; AI.fallback(row, 'auth'); expect(row.play).toContain('Invalid');
    row = {}; AI.fallback(row, 'rate_limit'); expect(row.play).toContain('Rate limited');
    row = {}; AI.fallback(row, 'all_failed'); expect(row.play).toContain('LLM failed');
    row = {}; AI.fallback(row, 'unknown'); expect(row.play).toContain('Sync again');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: ContextParser
// ═══════════════════════════════════════════════════════════════════════════════

describe('ContextParser.clean', () => {
  test('returns null for invalid input', () => {
    expect(ContextParser.clean('', 'linkedin')).toBeNull();
    expect(ContextParser.clean(null, 'linkedin')).toBeNull();
    expect(ContextParser.clean('Too short', 'linkedin')).toBeNull();
  });

  test('parses LinkedIn content', () => {
    const input = 'John Smith\nEngineer\n\nExperience\nGoogle Engineer 2020-2023 Built amazing things and led teams\n\nEducation\nStanford';
    const result = ContextParser.clean(input, 'linkedin');
    expect(result).toContain('NAME:');
    expect(result).toContain('EXPERIENCE:');
  });

  test('parses resume content', () => {
    const input = 'John Smith\n\nEXPERIENCE\nGoogle Engineer 2020-2023 Built systems\n\nEDUCATION\nStanford CS';
    const result = ContextParser.clean(input, 'resume');
    expect(result).toContain('EXPERIENCE:');
    expect(result.length).toBeGreaterThan(50);
  });
});

describe('ContextParser.score', () => {
  test('returns 0 for null', () => {
    expect(ContextParser.score(null)).toBe(0);
  });

  test('scores based on content', () => {
    const low = 'NAME: John';
    const high = 'NAME: John\n\nEXPERIENCE: ' + 'A'.repeat(600) + '\n\nEDUCATION: Stanford';
    expect(ContextParser.score(high)).toBeGreaterThan(ContextParser.score(low));
  });

  test('caps at 100', () => {
    const max = 'NAME: John\n\nEXPERIENCE: ' + 'A'.repeat(2000) + '\n\nEDUCATION: Stanford';
    expect(ContextParser.score(max)).toBeLessThanOrEqual(100);
  });
});

describe('ContextParser.sanitizeForPrompt', () => {
  test('removes dangerous patterns', () => {
    expect(ContextParser.sanitizeForPrompt('```code```')).not.toContain('```');
    expect(ContextParser.sanitizeForPrompt('${var}')).not.toContain('${');
    expect(ContextParser.sanitizeForPrompt('SYSTEM: hack')).not.toContain('SYSTEM:');
  });

  test('truncates long input', () => {
    expect(ContextParser.sanitizeForPrompt('A'.repeat(5000)).length).toBe(4000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Provider Logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('Provider selection', () => {
  function selectProvider(keys) {
    return keys.groq ? 'groq' : keys.gemini ? 'gemini' : null;
  }

  test('selects Groq first', () => {
    expect(selectProvider({ groq: 'x', gemini: 'y' })).toBe('groq');
  });

  test('falls back to Gemini', () => {
    expect(selectProvider({ gemini: 'y' })).toBe('gemini');
  });

  test('returns null when no keys', () => {
    expect(selectProvider({})).toBeNull();
  });
});

describe('Provider failover', () => {
  function getNextProvider(current, keys) {
    if (current === 'groq' && keys.gemini) return 'gemini';
    return null;
  }

  test('fails over from Groq to Gemini', () => {
    expect(getNextProvider('groq', { groq: 'x', gemini: 'y' })).toBe('gemini');
  });

  test('returns null at end of chain', () => {
    expect(getNextProvider('gemini', { gemini: 'x' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Caching Logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cache versioning', () => {
  function shouldInvalidate(stored, current) {
    return stored < current;
  }

  test('invalidates old cache', () => {
    expect(shouldInvalidate(1, 2)).toBe(true);
  });

  test('keeps current cache', () => {
    expect(shouldInvalidate(2, 2)).toBe(false);
  });
});

describe('Filter cache logic', () => {
  function shouldSkipFilter(cached) {
    return cached && cached.isJobThread !== undefined;
  }

  test('skips when cached', () => {
    expect(shouldSkipFilter({ isJobThread: true })).toBe(true);
    expect(shouldSkipFilter({ isJobThread: false })).toBe(true);
  });

  test('does not skip when not cached', () => {
    expect(shouldSkipFilter(null)).toBeFalsy();
    expect(shouldSkipFilter({})).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Batching
// ═══════════════════════════════════════════════════════════════════════════════

describe('Batching', () => {
  function createBatches(items, size) {
    const batches = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }

  test('creates correct batches', () => {
    expect(createBatches([1,2,3,4,5], 2)).toEqual([[1,2], [3,4], [5]]);
    expect(createBatches([], 10)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Digest Helpers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Digest helpers', () => {
  test('formats contact name', () => {
    const format = (c) => c.split('.').map(s => s.replace(/^\w/, ch => ch.toUpperCase())).join(' ');
    expect(format('john.smith')).toBe('John Smith');
    expect(format('john')).toBe('John');
  });

  test('counts new threads', () => {
    const count = (rows, days) => {
      const cutoff = Date.now() - days * 86400000;
      return rows.filter(r => (r.firstSeen || 0) > cutoff).length;
    };
    const now = Date.now();
    expect(count([{ firstSeen: now }, { firstSeen: now - 10 * 86400000 }], 7)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: saveAndInit edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('saveAndInit validation', () => {
  test('requires at least one key', () => {
    const validate = (keys) => !!(keys.groq || keys.gemini);
    expect(validate({})).toBe(false);
    expect(validate({ groq: 'x' })).toBe(true);
    expect(validate({ gemini: 'x' })).toBe(true);
  });
});

describe('Top plays extraction', () => {
  test('filters out Waiting status', () => {
    const extract = (rows) => rows.filter(r => r.status.label !== 'Waiting').slice(0, 3);
    const rows = [
      { status: { label: 'Reply Needed' } },
      { status: { label: 'Waiting' } },
      { status: { label: 'Follow Up' } },
    ];
    expect(extract(rows)).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Context quality gate
// ═══════════════════════════════════════════════════════════════════════════════

describe('Context quality gate', () => {
  test('accepts good content', () => {
    const good = 'John Smith\nEngineer\n\nExperience\nGoogle Engineer 2020-2023 Built systems\n\nEducation\nStanford';
    const parsed = ContextParser.clean(good, 'linkedin');
    expect(ContextParser.score(parsed)).toBeGreaterThanOrEqual(30);
  });

  test('rejects garbage', () => {
    const bad = 'random garbage text nothing useful here at all just typing stuff';
    const parsed = ContextParser.clean(bad, 'linkedin');
    expect(ContextParser.score(parsed)).toBeLessThan(30);
  });
});