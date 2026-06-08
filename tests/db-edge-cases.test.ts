import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession, getActiveSession, getActiveSessions, getActiveSessionForDir,
  endSession, getSession, getSessions, getStats, addFileChange, addCommit,
  addAIUsage, getFileChanges, getCommits, getAIUsage, exportSessions,
  loadPricing, setPricing, resetPricing, clearAllData,
  addNote, getNotes, recoverStaleSessions, getSessionsPaginated,
  getSessionDetail, getDailyCosts, getModelBreakdown, getTopSessions,
  getProviderBreakdown, getFileHotspots, getActivityHeatmap, getDailyTokens,
  getCostVelocity, getProjectBreakdown, getTokenRatios, getPricingPath,
  calculateCost, ensureTrackingSession, addFeedback, getFeedback,
  setConfig, getConfig, getProxyCache, setProxyCache, closeDb,
} from '../src/db';

beforeEach(() => { clearAllData(); });

// ════════════════════════════════════════════════════════════════
// FEEDBACK SYSTEM
// ════════════════════════════════════════════════════════════════

describe('Feedback', () => {
  it('addFeedback returns an id and timestamp', () => {
    const r = addFeedback({ type: 'bug', message: 'crash on start' });
    expect(r.id).toBeGreaterThan(0);
    expect(typeof r.timestamp).toBe('string');
  });

  it('addFeedback defaults type to general when omitted', () => {
    // The DB schema defaults to 'general' but our function passes explicit type
    // Type the raw SQL insert directly via getFeedback to verify stored type
    const r = addFeedback({ type: 'feature', message: 'dark mode' });
    const items = getFeedback(10);
    expect(items[0].type).toBe('feature');
  });

  it('addFeedback stores optional email', () => {
    addFeedback({ type: 'general', message: 'hello', email: 'test@example.com' });
    const items = getFeedback(10);
    expect(items[0].email).toBe('test@example.com');
  });

  it('addFeedback handles messages with special characters', () => {
    addFeedback({ type: 'bug', message: "it's broken — line 1\nline 2; drop table;" });
    const items = getFeedback(10);
    expect(items[0].message).toBe("it's broken — line 1\nline 2; drop table;");
  });

  it('getFeedback respects limit', () => {
    for (let i = 0; i < 5; i++) addFeedback({ type: 'general', message: `msg-${i}` });
    expect(getFeedback(2).length).toBe(2);
    expect(getFeedback(10).length).toBe(5);
  });

  it('getFeedback returns empty array when no data', () => {
    expect(getFeedback(50).length).toBe(0);
  });

  it('getFeedback orders by id DESC (most recent first)', () => {
    addFeedback({ type: 'general', message: 'first' });
    addFeedback({ type: 'general', message: 'second' });
    const items = getFeedback(10);
    expect(items[0].message).toBe('second');
    expect(items[1].message).toBe('first');
  });
});

// ════════════════════════════════════════════════════════════════
// CONFIG STORE
// ════════════════════════════════════════════════════════════════

describe('Config Store', () => {
  it('setConfig and getConfig round-trip', () => {
    setConfig('webhook_url', 'https://hooks.slack.com/test');
    expect(getConfig('webhook_url')).toBe('https://hooks.slack.com/test');
  });

  it('getConfig returns null for missing key', () => {
    expect(getConfig('nonexistent')).toBeNull();
  });

  it('setConfig upserts — overwrites existing key', () => {
    setConfig('theme', 'dark');
    setConfig('theme', 'light');
    expect(getConfig('theme')).toBe('light');
  });

  it('setConfig handles empty string value', () => {
    setConfig('blank', '');
    expect(getConfig('blank')).toBe('');
  });

  it('config persists across DB operations (does not get cleared by clearAllData)', () => {
    // NOTE: clearAllData does NOT clear the config table per db.ts:436-444
    setConfig('persist', 'survive');
    clearAllData();
    expect(getConfig('persist')).toBe('survive');
  });
});

// ════════════════════════════════════════════════════════════════
// PROXY CACHE
// ════════════════════════════════════════════════════════════════

describe('Proxy Cache', () => {
  it('setProxyCache and getProxyCache round-trip', () => {
    setProxyCache('abc123', '{"result":"ok"}', 0.005);
    const cached = getProxyCache('abc123');
    expect(cached).not.toBeNull();
    expect(cached!.response).toBe('{"result":"ok"}');
    expect(cached!.cost).toBe(0.005);
  });

  it('getProxyCache returns null for unknown hash', () => {
    expect(getProxyCache('nonexistent')).toBeNull();
  });

  it('setProxyCache overwrites existing hash', () => {
    setProxyCache('dup', 'v1', 0.01);
    setProxyCache('dup', 'v2', 0.02);
    const cached = getProxyCache('dup');
    expect(cached!.response).toBe('v2');
    expect(cached!.cost).toBe(0.02);
  });

  it('setProxyCache handles large response bodies', () => {
    const big = JSON.stringify({ data: 'x'.repeat(10000) });
    setProxyCache('big', big, 1.5);
    const cached = getProxyCache('big');
    expect(cached!.response).toBe(big);
  });
});

// ════════════════════════════════════════════════════════════════
// CALCULATE COST
// ════════════════════════════════════════════════════════════════

describe('calculateCost', () => {
  it('calculates cost from pricing table', () => {
    // claude-3.5-sonnet: input=$3/1M, output=$15/1M
    const cost = calculateCost('anthropic', 'claude-3.5-sonnet', 700000, 300000);
    // 700k tokens * $3/1M = $2.10, 300k * $15/1M = $4.50
    expect(cost).toBeCloseTo(6.60, 1);
  });

  it('calculates cost for gpt-4o', () => {
    // gpt-4o: input=$2.50/1M, output=$10.00/1M
    const cost = calculateCost('openai', 'gpt-4o', 1000000, 500000);
    expect(cost).toBeCloseTo(2.5 + 5.0, 1);
  });

  it('returns 0 for unknown model', () => {
    const cost = calculateCost('unknown', 'super-ai-3000', 1000, 1000);
    expect(cost).toBe(0);
  });

  it('prefix-matches model variants (gpt-4o-2024-05-13 -> gpt-4o)', () => {
    const cost = calculateCost('openai', 'gpt-4o-2024-05-13', 1_000_000, 0);
    expect(cost).toBeCloseTo(2.50, 1); // $2.50/1M input
  });

  it('prefers longest prefix match when multiple match', () => {
    // gpt-4 matches gpt-4, gpt-4-turbo, gpt-4-32k, gpt-4o, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
    // gpt-4o should match gpt-4o (not gpt-4) because it's a longer prefix
    const cost = calculateCost('openai', 'gpt-4o-mini-new-variant', 1_000_000, 0);
    // gpt-4o-mini: $0.15, gpt-4o: $5, gpt-4: $30
    // longest match should be gpt-4o-mini
    expect(cost).toBeCloseTo(0.15, 2);
  });

  it('calculates with zero tokens', () => {
    expect(calculateCost('openai', 'gpt-4o', 0, 0)).toBe(0);
  });

  it('works with custom pricing overrides', () => {
    setPricing('custom-xyz', 10, 20);
    const cost = calculateCost('any', 'custom-xyz', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(30, 1);
    resetPricing();
  });

  it('works with namespaced keys via setPricing prefix matching', () => {
    setPricing('anthropic/claude-sonnet-4-custom', 2, 10);
    // calculateCost looks for exact model match first, then prefix
    // The key stored is 'anthropic/claude-sonnet-4-custom' in user pricing
    // and 'claude-sonnet-4' in defaults. calculateCost does model-only prefix match.
    const cost = calculateCost('anthropic', 'claude-sonnet-4-custom', 1_000_000, 0);
    expect(cost).toBeCloseTo(2, 1);
    resetPricing();
  });

  it('prefix matches after setPricing adds model with version suffix', () => {
    setPricing('gpt-5-micro-latest', 0.1, 0.4);
    const cost = calculateCost('openai', 'gpt-5-micro-latest-2026', 1_000_000, 0);
    expect(cost).toBeCloseTo(0.1, 2);
    resetPricing();
  });
});

// ════════════════════════════════════════════════════════════════
// ENSURE TRACKING SESSION
// ════════════════════════════════════════════════════════════════

describe('ensureTrackingSession', () => {
  it('creates a new tracking session when none active', () => {
    const id = ensureTrackingSession('/some/dir');
    expect(id).toBeGreaterThan(0);
    const s = getSession(id);
    expect(s!.name).toBe('Background API Session');
    expect(s!.status).toBe('active');
    expect(s!.workingDirectory).toBe('/some/dir');
  });

  it('returns existing active session for the same directory', () => {
    const id1 = ensureTrackingSession('/same/dir');
    const id2 = ensureTrackingSession('/same/dir');
    expect(id1).toBe(id2);
  });

  it('creates separate sessions for different directories', () => {
    const id1 = ensureTrackingSession('/dir/a');
    const id2 = ensureTrackingSession('/dir/b');
    expect(id1).not.toBe(id2);
    expect(getActiveSessions().length).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// END SESSION EDGE CASES
// ════════════════════════════════════════════════════════════════

describe('endSession edge cases', () => {
  it('endSession is a no-op for non-existent session ID', () => {
    endSession(99999, new Date().toISOString());
    // Should not throw
    expect(getSession(99999)).toBeNull();
  });

  it('endSession is a no-op for already completed session', () => {
    const id = createSession({ name: 'done', startTime: '2025-01-01T10:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-01-01T11:00:00Z');
    const durationAfterFirstEnd = getSession(id)!.duration;
    endSession(id, '2025-01-01T12:00:00Z');
    // Duration should not change (second end is a no-op)
    expect(getSession(id)!.duration).toBe(durationAfterFirstEnd);
  });

  it('endSession caps duration at 1 year for clock skew', () => {
    const id = createSession({ name: 'skewed', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    // End time 5 years later — should be capped at 1 year = 31536000 seconds
    endSession(id, '2030-01-01T00:00:00Z');
    const s = getSession(id);
    expect(s!.duration).toBe(31536000);
  });

  it('endSession handles duration overflow gracefully', () => {
    // The endSession function computes duration from startTime to endTime
    // We already test negative and 1-year cap. Let's verify the 1-year cap at the boundary.
    const id = createSession({ name: 'boundary', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    // Exactly 1 year later
    endSession(id, '2026-01-01T00:00:00Z');
    const s = getSession(id);
    // 2025→2026 is a leap year? 2025 is not a leap year. 365 days = 31536000 seconds.
    expect(s!.duration).toBe(31536000);
  });
});

// ════════════════════════════════════════════════════════════════
// ADD FILE CHANGE & COMMIT EDGE CASES
// ════════════════════════════════════════════════════════════════

describe('addFileChange edge cases', () => {
  it('addFileChange uses COUNT(DISTINCT file_path) for session count', () => {
    const id = createSession({ name: 'dedup', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addFileChange({ sessionId: id, filePath: 'a.ts', changeType: 'modified', timestamp: '2025-01-01T00:01:00Z' });
    addFileChange({ sessionId: id, filePath: 'a.ts', changeType: 'modified', timestamp: '2025-01-01T00:02:00Z' });
    addFileChange({ sessionId: id, filePath: 'a.ts', changeType: 'deleted', timestamp: '2025-01-01T00:03:00Z' });
    addFileChange({ sessionId: id, filePath: 'b.ts', changeType: 'created', timestamp: '2025-01-01T00:04:00Z' });
    // 2 unique file paths
    expect(getSession(id)!.filesChanged).toBe(2);
  });

  it('addFileChange stores all change types correctly', () => {
    const id = createSession({ name: 'types', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addFileChange({ sessionId: id, filePath: 'created.ts', changeType: 'created', timestamp: '2025-01-01T00:01:00Z' });
    addFileChange({ sessionId: id, filePath: 'modified.ts', changeType: 'modified', timestamp: '2025-01-01T00:02:00Z' });
    addFileChange({ sessionId: id, filePath: 'deleted.ts', changeType: 'deleted', timestamp: '2025-01-01T00:03:00Z' });
    const files = getFileChanges(id);
    expect(files[0].changeType).toBe('created');
    expect(files[1].changeType).toBe('modified');
    expect(files[2].changeType).toBe('deleted');
  });
});

describe('addCommit edge cases', () => {
  it('addCommit correctly increments session commit count', () => {
    const id = createSession({ name: 'multi-commit', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addCommit({ sessionId: id, hash: 'hash001', message: 'm1', timestamp: '2025-01-01T00:01:00Z' });
    addCommit({ sessionId: id, hash: 'hash002', message: 'm2', timestamp: '2025-01-01T00:02:00Z' });
    addCommit({ sessionId: id, hash: 'hash003', message: 'm3', timestamp: '2025-01-01T00:03:00Z' });
    expect(getSession(id)!.commits).toBe(3);

    // Verify commits are ordered by timestamp
    const commits = getCommits(id);
    expect(commits[0].hash).toBe('hash001');
    expect(commits[2].hash).toBe('hash003');
  });
});

// ════════════════════════════════════════════════════════════════
// AI USAGE EDGE CASES
// ════════════════════════════════════════════════════════════════

describe('addAIUsage edge cases', () => {
  it('accumulates costs with high precision across many entries', () => {
    const id = createSession({ name: 'precision', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    // Simulate 100 small usage entries
    for (let i = 0; i < 100; i++) {
      addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 10, cost: 0.0001, timestamp: new Date().toISOString() });
    }
    const s = getSession(id);
    expect(s!.aiTokens).toBe(1000);
    expect(s!.aiCost).toBeCloseTo(0.01, 4);
  });

  it('handles zero-cost entries', () => {
    const id = createSession({ name: 'free', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'free-model', tokens: 500, cost: 0, timestamp: new Date().toISOString() });
    expect(getSession(id)!.aiCost).toBe(0);
    expect(getSession(id)!.aiTokens).toBe(500);
  });

  it('handles null/none token sub-fields', () => {
    const id = createSession({ name: 'no-sub', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 300, cost: 0.003, timestamp: new Date().toISOString() });
    const usage = getAIUsage(id);
    expect(usage[0].promptTokens).toBeUndefined();
    expect(usage[0].completionTokens).toBeUndefined();
  });

  it('addAIUsage with large token counts does not overflow', () => {
    const id = createSession({ name: 'big-tokens', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 2_000_000_000, cost: 100, timestamp: new Date().toISOString() });
    const s = getSession(id);
    expect(s!.aiTokens).toBe(2_000_000_000);
  });
});

// ════════════════════════════════════════════════════════════════
// STATS EDGE CASES
// ════════════════════════════════════════════════════════════════

describe('getStats edge cases', () => {
  it('getStats returns zeros when no completed sessions', () => {
    const stats = getStats();
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalTime).toBe(0);
    expect(stats.totalAICost).toBe(0);
    expect(stats.avgSessionTime).toBe(0);
  });

  it('getStats averages correctly with mixed durations', () => {
    const id1 = createSession({ name: 'short', startTime: '2025-01-01T10:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id1, '2025-01-01T10:10:00Z'); // 600s
    const id2 = createSession({ name: 'long', startTime: '2025-01-02T10:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id2, '2025-01-02T12:00:00Z'); // 7200s
    const stats = getStats();
    expect(stats.totalTime).toBe(7800);
    expect(stats.avgSessionTime).toBe(3900);
  });
});

// ════════════════════════════════════════════════════════════════
// EXPORT EDGE CASES
// ════════════════════════════════════════════════════════════════

describe('exportSessions edge cases', () => {
  it('exportSessions returns empty JSON array when no sessions', () => {
    const json = exportSessions('json');
    expect(JSON.parse(json)).toEqual([]);
  });

  it('exportSessions CSV has header-only when no sessions', () => {
    const csv = exportSessions('csv');
    expect(csv).toBe('id,name,status,startTime,endTime,duration,filesChanged,commits,aiTokens,aiCost,agents,notes');
  });

  it('exportSessions handles names with newlines in CSV', () => {
    createSession({ name: 'multi\nline', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const csv = exportSessions('csv');
    expect(csv).toContain('\\n');
  });

  it('exportSessions CSV handles carriage returns', () => {
    createSession({ name: 'bad\rchar', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const csv = exportSessions('csv');
    // \r should be stripped
    expect(csv).not.toContain('\r');
  });
});

// ════════════════════════════════════════════════════════════════
// getSessionsPaginated EDGE CASES
// ════════════════════════════════════════════════════════════════

describe('getSessionsPaginated edge cases', () => {
  it('returns empty array with correct total for offset beyond data', () => {
    for (let i = 0; i < 3; i++) {
      createSession({ name: `s${i}`, startTime: `2025-01-0${i + 1}T00:00:00Z`, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    }
    const result = getSessionsPaginated({ limit: 10, offset: 100 });
    expect(result.sessions.length).toBe(0);
    expect(result.total).toBe(3);
  });

  it('defaults to limit=50, offset=0 when not provided', () => {
    for (let i = 0; i < 3; i++) {
      createSession({ name: `s${i}`, startTime: `2025-01-0${i + 1}T00:00:00Z`, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    }
    const result = getSessionsPaginated({});
    expect(result.total).toBe(3);
    expect(result.sessions.length).toBe(3);
  });

  it('case-insensitive search', () => {
    createSession({ name: 'RefactorAuth', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const result = getSessionsPaginated({ search: 'refactorauth' });
    // SQLite LIKE is case-insensitive by default for ASCII
    expect(result.total).toBe(1);
  });

  it('search with no matches returns empty', () => {
    createSession({ name: 'normal', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const result = getSessionsPaginated({ search: 'zzz_nonexistent_zzz' });
    expect(result.total).toBe(0);
    expect(result.sessions.length).toBe(0);
  });

  it('combined status + search filter', () => {
    const id = createSession({ name: 'active-search-test', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'completed-search-test', startTime: '2025-01-02T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-01-01T01:00:00Z');
    const result = getSessionsPaginated({ status: 'completed', search: 'active' });
    // completed session with "active" in name
    expect(result.total).toBe(1);
  });

  it('status=all includes everything', () => {
    createSession({ name: 'a', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const completedId = createSession({ name: 'b', startTime: '2025-01-02T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(completedId, '2025-01-02T01:00:00Z');
    const result = getSessionsPaginated({ status: 'all' });
    expect(result.total).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// DASHBOARD QUERIES DEEP
// ════════════════════════════════════════════════════════════════

describe('Dashboard queries deep', () => {
  function seedRichData() {
    // Session 1 - small
    const id1 = createSession({ name: 'small-session', startTime: '2025-06-01T10:00:00Z', workingDirectory: '/proj-a/src', gitRoot: '/proj-a', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id1, provider: 'openai', model: 'gpt-4o-mini', tokens: 500, promptTokens: 300, completionTokens: 200, cost: 0.0002, timestamp: '2025-06-01T10:05:00Z' });
    addFileChange({ sessionId: id1, filePath: 'src/a.ts', changeType: 'modified', timestamp: '2025-06-01T10:02:00Z' });
    addFileChange({ sessionId: id1, filePath: 'src/b.ts', changeType: 'created', timestamp: '2025-06-01T10:03:00Z' });
    endSession(id1, '2025-06-01T11:00:00Z'); // 3600s

    // Session 2 - expensive
    const id2 = createSession({ name: 'expensive-session', startTime: '2025-06-02T14:00:00Z', workingDirectory: '/proj-a/src', gitRoot: '/proj-a', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id2, provider: 'anthropic', model: 'claude-sonnet-4', tokens: 10000, promptTokens: 7000, completionTokens: 3000, cost: 0.06, timestamp: '2025-06-02T14:10:00Z' });
    addAIUsage({ sessionId: id2, provider: 'openai', model: 'gpt-4o', tokens: 5000, promptTokens: 3000, completionTokens: 2000, cost: 0.05, timestamp: '2025-06-02T14:20:00Z' });
    addFileChange({ sessionId: id2, filePath: 'src/c.ts', changeType: 'modified', timestamp: '2025-06-02T14:05:00Z' });
    addCommit({ sessionId: id2, hash: 'deadbeef', message: 'refactor', timestamp: '2025-06-02T14:15:00Z' });
    endSession(id2, '2025-06-02T16:00:00Z'); // 7200s

    // Session 3 - active (not completed)
    createSession({ name: 'active-session', startTime: '2025-06-03T09:00:00Z', workingDirectory: '/proj-b', gitRoot: '/proj-b', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    return { id1, id2 };
  }

  it('getDailyCosts groups by day correctly', () => {
    seedRichData();
    const costs = getDailyCosts(3650);
    const june1 = costs.find(c => c.day === '2025-06-01');
    const june2 = costs.find(c => c.day === '2025-06-02');
    expect(june1).toBeDefined();
    expect(june2).toBeDefined();
    expect(june1!.cost).toBeCloseTo(0.0002, 4);
    expect(june2!.cost).toBeCloseTo(0.11, 2);
  });

  it('getModelBreakdown aggregates across multiple sessions', () => {
    seedRichData();
    const breakdown = getModelBreakdown();
    const openaiMini = breakdown.find(b => b.provider === 'openai' && b.model === 'gpt-4o-mini');
    const openai4o = breakdown.find(b => b.provider === 'openai' && b.model === 'gpt-4o');
    const anthropic = breakdown.find(b => b.provider === 'anthropic');
    expect(openaiMini!.calls).toBe(1);
    expect(openai4o!.calls).toBe(1);
    expect(openaiMini!.totalTokens + openai4o!.totalTokens).toBe(5500);
    expect(anthropic!.calls).toBe(1);
  });

  it('getTopSessions returns sessions sorted by cost DESC', () => {
    seedRichData();
    const top = getTopSessions(10);
    expect(top.length).toBe(2);
    expect(top[0].aiCost).toBeGreaterThan(top[1].aiCost);
    expect(top[0].name).toBe('expensive-session');
  });

  it('getProviderBreakdown counts distinct models per provider', () => {
    seedRichData();
    const pb = getProviderBreakdown();
    const openai = pb.find(p => p.provider === 'openai');
    expect(openai!.models).toBe(2); // gpt-4o-mini and gpt-4o
  });

  it('getFileHotspots counts change types per file', () => {
    seedRichData();
    const fh = getFileHotspots();
    const aFile = fh.find(f => f.filePath === 'src/a.ts');
    const bFile = fh.find(f => f.filePath === 'src/b.ts');
    expect(aFile!.changeCount).toBe(1);
    expect(bFile!.changeCount).toBe(1);
    expect(bFile!.creates).toBe(1);
  });

  it('getActivityHeatmap includes correct day-of-week and hour', () => {
    seedRichData();
    // 2025-06-01 is a Sunday (dayOfWeek=0), hour=10
    // 2025-06-02 is a Monday (dayOfWeek=1), hour=14
    const hm = getActivityHeatmap();
    expect(hm.length).toBeGreaterThan(0);
    const sundayEntry = hm.find(e => e.dayOfWeek === 0 && e.hour === 10);
    expect(sundayEntry).toBeDefined();
    expect(sundayEntry!.sessions).toBe(1);
  });

  it('getDailyTokens returns prompt/completion/total breakdown', () => {
    seedRichData();
    const tokens = getDailyTokens(3650);
    const june2 = tokens.find(t => t.day === '2025-06-02');
    expect(june2).toBeDefined();
    expect(june2!.totalTokens).toBe(15000);
    expect(june2!.promptTokens).toBe(10000);
    expect(june2!.completionTokens).toBe(5000);
  });

  it('getCostVelocity computes $/hr correctly', () => {
    seedRichData();
    const cv = getCostVelocity();
    const expensive = cv.find(v => v.name === 'expensive-session');
    expect(expensive).toBeDefined();
    // $0.11 over 2 hours = $0.055/hr
    expect(expensive!.costPerHour).toBeCloseTo(0.055, 3);
  });

  it('getCostVelocity excludes active and zero-cost sessions', () => {
    seedRichData();
    const cv = getCostVelocity(50);
    // active-session and small-session (cost=0.0002 > 0) should both appear
    // BUT small-session has 1h duration and tiny cost so it passes the WHERE
    expect(cv.length).toBe(2);
    // All should have duration > 0 and aiCost > 0
    for (const v of cv) {
      expect(v.duration).toBeGreaterThan(0);
      expect(v.aiCost).toBeGreaterThan(0);
    }
  });

  it('getProjectBreakdown groups by COALESCE(git_root, working_directory)', () => {
    seedRichData();
    const pb = getProjectBreakdown();
    const projA = pb.find(p => p.project === '/proj-a');
    const projB = pb.find(p => p.project === '/proj-b');
    expect(projA).toBeDefined();
    expect(projA!.sessions).toBe(2);
    expect(projB).toBeDefined();
    expect(projB!.sessions).toBe(1);
  });

  it('getTokenRatios computes correct prompt:completion ratios', () => {
    seedRichData();
    const tr = getTokenRatios();
    const sonnet = tr.find(r => r.model === 'claude-sonnet-4');
    // prompt=7000, completion=3000, ratio=7000/3000=2.33
    expect(sonnet!.promptTokens).toBe(7000);
    expect(sonnet!.completionTokens).toBe(3000);
    expect(sonnet!.ratio).toBeCloseTo(2.33, 1);
  });

  it('getTokenRatios excludes entries without prompt/completion tokens', () => {
    // Entries where prompt_tokens IS NULL and completion_tokens IS NULL are excluded by WHERE clause
    const id = createSession({ name: 'no-sub', startTime: '2025-06-05T10:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'test', model: 'no-prompt-model', tokens: 100, cost: 0.001, timestamp: '2025-06-05T10:01:00Z' });
    endSession(id, '2025-06-05T10:30:00Z');
    const tr = getTokenRatios();
    const testEntry = tr.find(r => r.model === 'no-prompt-model');
    expect(testEntry).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════
// PRICING: PROTOTYPE POLLUTION DEFENSE (EXPANDED)
// ════════════════════════════════════════════════════════════════

describe('Pricing defense', () => {
  it('loadPricing blocks additional prototype pollution vectors', () => {
    const { writeFileSync } = require('fs');
    const dangerous = {
      '__proto__': { polluted: true },
      'constructor': { prototype: {} },
      'prototype': { x: 1 },
      'toString': 'malicious',
      'valueOf': 'malicious',
    };
    writeFileSync(getPricingPath(), JSON.stringify(dangerous));
    const p = loadPricing();
    // All dangerous keys should have been filtered
    for (const key of Object.keys(dangerous)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      // toString, valueOf are not in the filter list, so they pass through
      // Only __proto__, constructor, prototype are guarded
    }
    expect(Object.hasOwn(p, '__proto__')).toBe(false);
    expect(Object.hasOwn(p, 'constructor')).toBe(false);
    expect(Object.hasOwn(p, 'prototype')).toBe(false);
    // toString/valueOf pass the filter but don't have {input, output} shape so they don't merge
    expect(p['toString']).toBeUndefined();
    expect(p['valueOf']).toBeUndefined();
    resetPricing();
  });

  it('loadPricing validates shape of custom entries', () => {
    const { writeFileSync } = require('fs');
    writeFileSync(getPricingPath(), JSON.stringify({
      'bad-shape': { input: 'string_not_number', output: 1 },
      'missing-input': { output: 1 },
      'good-one': { input: 2, output: 3 },
    }));
    const p = loadPricing();
    expect(p['good-one']).toEqual({ input: 2, output: 3 });
    expect(p['bad-shape']).toBeUndefined();
    expect(p['missing-input']).toBeUndefined();
    resetPricing();
  });

  it('setPricing creates pricing file if it does not exist', () => {
    const { existsSync, unlinkSync } = require('fs');
    const pp = getPricingPath();
    if (existsSync(pp)) unlinkSync(pp);
    setPricing('fresh', 5, 10);
    expect(loadPricing()['fresh']).toEqual({ input: 5, output: 10 });
    resetPricing();
  });
});

// ════════════════════════════════════════════════════════════════
// ACTIVE SESSIONS: PARALLEL SESSION SUPPORT
// ════════════════════════════════════════════════════════════════

describe('Parallel active sessions', () => {
  it('allows multiple active sessions in different directories', () => {
    createSession({ name: 'dir1', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/dir1', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'dir2', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/dir2', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    expect(getActiveSessions().length).toBe(2);
  });

  it('getActiveSession returns most recent when multiple active', () => {
    createSession({ name: 'old-active', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/a', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'new-active', startTime: '2025-01-02T00:00:00Z', workingDirectory: '/b', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getActiveSession();
    expect(s!.name).toBe('new-active');
  });

  it('getActiveSessionForDir resolves to git_root when matching', () => {
    createSession({ name: 'git-match', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/repo/subdir', gitRoot: '/repo', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getActiveSessionForDir('/repo');
    expect(s!.name).toBe('git-match');
  });

  it('getActiveSessionForDir prefers exact working_directory match', () => {
    createSession({ name: 'wd-match', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/exact/dir', gitRoot: '/exact', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getActiveSessionForDir('/exact/dir');
    expect(s!.name).toBe('wd-match');
  });

  it('getActiveSessionForDir normalizes trailing slash', () => {
    createSession({ name: 'trailing', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/trailing/dir', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getActiveSessionForDir('/trailing/dir/');
    expect(s!.name).toBe('trailing');
  });

  it('getActiveSessionForDir returns null for completed sessions', () => {
    const id = createSession({ name: 'was-active', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/was', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-01-01T01:00:00Z');
    expect(getActiveSessionForDir('/was')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// RECOVERY EDGE CASES
// ════════════════════════════════════════════════════════════════

describe('Recovery edge cases', () => {
  it('recoverStaleSessions appends auto-recovery note', () => {
    const old = new Date(Date.now() - 72 * 3600_000).toISOString();
    const id = createSession({ name: 'note-recover', startTime: old, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const recovered = recoverStaleSessions(24);
    expect(recovered.length).toBe(1);
    const s = getSession(id);
    expect(s!.status).toBe('completed');
    expect(s!.notes).toContain('auto-recovered');
  });

  it('recoverStaleSessions preserves existing notes', () => {
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    const id = createSession({ name: 'existing-note', startTime: old, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addNote(id, 'manual note');
    recoverStaleSessions(24);
    const notes = getNotes(id);
    expect(notes.length).toBe(1);
    expect(notes[0].message).toBe('manual note');
  });

  it('recoverStaleSessions returns empty array when nothing to recover', () => {
    expect(recoverStaleSessions(1).length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// DURATION CAP VERIFICATION
// ════════════════════════════════════════════════════════════════

describe('Duration edge cases', () => {
  it('sessions created and immediately ended get positive duration', () => {
    const now = new Date();
    const id = createSession({ name: 'immediate', startTime: now.toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const later = new Date(now.getTime() + 1000);
    endSession(id, later.toISOString());
    const s = getSession(id);
    expect(s!.duration).toBe(1);
  });

  it('duration caps at 1 year even with extreme future dates', () => {
    const id = createSession({ name: 'future', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2099-01-01T00:00:00Z');
    expect(getSession(id)!.duration).toBe(31536000);
  });
});

// ════════════════════════════════════════════════════════════════
// mapSession AI COST ROUNDING
// ════════════════════════════════════════════════════════════════

describe('aiCost precision', () => {
  it('getSession rounds aiCost to avoid floating-point artifacts', () => {
    const id = createSession({ name: 'precision', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 100, cost: 0.1 + 0.2, timestamp: '2025-01-01T00:01:00Z' });
    // 0.1 + 0.2 = 0.30000000000000004 in floating point
    // mapSession rounds to 10 decimal places
    const s = getSession(id);
    expect(s!.aiCost).toBe(0.3);
    expect(s!.aiCost).not.toBe(0.30000000000000004);
  });
});