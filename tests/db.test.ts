import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession, getActiveSession, getActiveSessions, getActiveSessionForDir,
  endSession, getSession, getSessions, getStats, addFileChange, addCommit,
  addAIUsage, getFileChanges, getCommits, getAIUsage, exportSessions,
  loadPricing, setPricing, resetPricing, clearAllData, addNote, getNotes,
  recoverStaleSessions, getSessionsPaginated, getSessionDetail,
  getDailyCosts, getModelBreakdown, getTopSessions, getProviderBreakdown,
  getFileHotspots, getActivityHeatmap, getDailyTokens, getCostVelocity,
  getProjectBreakdown, getTokenRatios, getPricingPath
} from '../src/db';

beforeEach(() => { clearAllData(); });

// ── Session CRUD ──────────────────────────────────────────

describe('Session CRUD', () => {
  it('creates a session and returns a positive ID', () => {
    const id = createSession({ name: 'test', startTime: new Date().toISOString(), workingDirectory: '/tmp/test', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    expect(id).toBeGreaterThan(0);
  });

  it('getSession retrieves by ID', () => {
    const id = createSession({ name: 'find-me', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getSession(id);
    expect(s).not.toBeNull();
    expect(s!.name).toBe('find-me');
    expect(s!.status).toBe('active');
  });

  it('getSession returns null for unknown ID', () => {
    expect(getSession(99999)).toBeNull();
  });

  it('getSessions respects limit and orders by start_time DESC', () => {
    createSession({ name: 'a', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'b', startTime: '2025-01-02T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'c', startTime: '2025-01-03T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const all = getSessions(10);
    expect(all.length).toBe(3);
    expect(all[0].name).toBe('c');
    const limited = getSessions(2);
    expect(limited.length).toBe(2);
  });

  it('endSession sets duration, status, and notes', () => {
    const id = createSession({ name: 'end-me', startTime: '2025-06-01T10:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-06-01T11:30:00Z', 'done');
    const s = getSession(id);
    expect(s!.status).toBe('completed');
    expect(s!.duration).toBe(5400);
    expect(s!.notes).toBe('done');
  });

  it('endSession caps negative duration to 0', () => {
    const id = createSession({ name: 'clock-skew', startTime: '2025-06-01T12:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-06-01T10:00:00Z');
    const s = getSession(id);
    expect(s!.duration).toBe(0);
  });
});

// ── Active Sessions ───────────────────────────────────────

describe('Active Sessions', () => {
  it('getActiveSession returns most recent active session', () => {
    createSession({ name: 'old', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const id2 = createSession({ name: 'new', startTime: '2025-01-02T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getActiveSession();
    expect(s).not.toBeNull();
    expect(s!.id).toBe(id2);
  });

  it('getActiveSession returns null when none active', () => {
    const id = createSession({ name: 't', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-01-01T01:00:00Z');
    expect(getActiveSession()).toBeNull();
  });

  it('getActiveSessions returns all active sessions', () => {
    createSession({ name: 'a1', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w1', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'a2', startTime: '2025-01-02T00:00:00Z', workingDirectory: '/w2', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    expect(getActiveSessions().length).toBe(2);
  });

  it('getActiveSessionForDir matches working_directory', () => {
    createSession({ name: 'proj', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/home/user/project', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getActiveSessionForDir('/home/user/project');
    expect(s).not.toBeNull();
    expect(s!.name).toBe('proj');
  });

  it('getActiveSessionForDir matches git_root', () => {
    createSession({ name: 'git-proj', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/home/user/project/src', gitRoot: '/home/user/project', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getActiveSessionForDir('/home/user/project');
    expect(s).not.toBeNull();
    expect(s!.name).toBe('git-proj');
  });

  it('getActiveSessionForDir normalizes Windows path casing', () => {
    createSession({ name: 'win-proj', startTime: '2025-01-01T00:00:00Z', workingDirectory: 'C:\\Users\\Dev\\Project', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const s = getActiveSessionForDir('c:/users/dev/project');
    expect(s).not.toBeNull();
    expect(s!.name).toBe('win-proj');
  });

  it('getActiveSessionForDir returns null for no match', () => {
    createSession({ name: 'other', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/other', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    expect(getActiveSessionForDir('/not-other')).toBeNull();
  });
});

// ── File Changes ──────────────────────────────────────────

describe('File Changes', () => {
  it('addFileChange records change and updates session count', () => {
    const id = createSession({ name: 'fc', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addFileChange({ sessionId: id, filePath: 'src/a.ts', changeType: 'created', timestamp: '2025-01-01T00:01:00Z' });
    addFileChange({ sessionId: id, filePath: 'src/b.ts', changeType: 'modified', timestamp: '2025-01-01T00:02:00Z' });
    const files = getFileChanges(id);
    expect(files.length).toBe(2);
    const s = getSession(id);
    expect(s!.filesChanged).toBe(2);
  });

  it('counts unique file paths for filesChanged', () => {
    const id = createSession({ name: 'fc2', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addFileChange({ sessionId: id, filePath: 'a.ts', changeType: 'modified', timestamp: '2025-01-01T00:01:00Z' });
    addFileChange({ sessionId: id, filePath: 'a.ts', changeType: 'modified', timestamp: '2025-01-01T00:02:00Z' });
    expect(getSession(id)!.filesChanged).toBe(1); // COUNT(DISTINCT file_path)
  });
});

// ── Commits ───────────────────────────────────────────────

describe('Commits', () => {
  it('addCommit records commit and updates session count', () => {
    const id = createSession({ name: 'cm', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addCommit({ sessionId: id, hash: 'abc1234', message: 'fix bug', timestamp: '2025-01-01T00:01:00Z' });
    addCommit({ sessionId: id, hash: 'def5678', message: 'add feature', timestamp: '2025-01-01T00:02:00Z' });
    const commits = getCommits(id);
    expect(commits.length).toBe(2);
    expect(commits[0].hash).toBe('abc1234');
    expect(getSession(id)!.commits).toBe(2);
  });
});

// ── AI Usage ──────────────────────────────────────────────

describe('AI Usage', () => {
  it('addAIUsage records usage and updates session totals', () => {
    const id = createSession({ name: 'ai', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'anthropic', model: 'claude-sonnet-4', tokens: 1000, promptTokens: 700, completionTokens: 300, cost: 0.006, timestamp: '2025-01-01T00:01:00Z' });
    const usage = getAIUsage(id);
    expect(usage.length).toBe(1);
    expect(usage[0].provider).toBe('anthropic');
    expect(usage[0].tokens).toBe(1000);
    const s = getSession(id);
    expect(s!.aiTokens).toBe(1000);
    expect(s!.aiCost).toBeCloseTo(0.006, 6);
  });

  it('accumulates multiple AI usage entries', () => {
    const id = createSession({ name: 'ai2', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'openai', model: 'gpt-4o', tokens: 500, cost: 0.005, timestamp: '2025-01-01T00:01:00Z' });
    addAIUsage({ sessionId: id, provider: 'openai', model: 'gpt-4o', tokens: 300, cost: 0.003, timestamp: '2025-01-01T00:02:00Z' });
    const s = getSession(id);
    expect(s!.aiTokens).toBe(800);
    expect(s!.aiCost).toBeCloseTo(0.008, 6);
  });

  it('handles agent name and optional tokens', () => {
    const id = createSession({ name: 'ai3', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'anthropic', model: 'claude-sonnet-4', tokens: 100, cost: 0.001, agentName: 'TestAgent', timestamp: '2025-01-01T00:01:00Z' });
    const usage = getAIUsage(id);
    expect(usage[0].agentName).toBe('TestAgent');
  });
});

// ── Notes ─────────────────────────────────────────────────

describe('Notes', () => {
  it('addNote creates a timestamped note', () => {
    const id = createSession({ name: 'n', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const note = addNote(id, 'important finding');
    expect(note.message).toBe('important finding');
    expect(note.sessionId).toBe(id);
    expect(note.id).toBeGreaterThan(0);
  });

  it('getNotes returns all notes for a session', () => {
    const id = createSession({ name: 'n2', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addNote(id, 'note1');
    addNote(id, 'note2');
    const notes = getNotes(id);
    expect(notes.length).toBe(2);
    expect(notes[0].message).toBe('note1');
  });
});

// ── Stats ─────────────────────────────────────────────────

describe('Stats', () => {
  it('getStats aggregates completed sessions', () => {
    const id1 = createSession({ name: 's1', startTime: '2025-01-01T10:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id1, provider: 'a', model: 'm', tokens: 100, cost: 1.0, timestamp: '2025-01-01T10:01:00Z' });
    endSession(id1, '2025-01-01T11:00:00Z');
    const id2 = createSession({ name: 's2', startTime: '2025-01-02T10:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id2, provider: 'a', model: 'm', tokens: 200, cost: 2.0, timestamp: '2025-01-02T10:01:00Z' });
    endSession(id2, '2025-01-02T12:00:00Z');
    const stats = getStats();
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalAICost).toBeCloseTo(3.0, 2);
    expect(stats.totalTime).toBe(3600 + 7200);
  });

  it('getStats excludes active sessions', () => {
    createSession({ name: 'active', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const stats = getStats();
    expect(stats.totalSessions).toBe(0);
  });
});

// ── Export ─────────────────────────────────────────────────

describe('Export', () => {
  it('exports as JSON', () => {
    const id = createSession({ name: 'export-test', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-01-01T01:00:00Z');
    const json = exportSessions('json');
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe('export-test');
  });

  it('exports as CSV with proper quoting', () => {
    const id = createSession({ name: 'has "quotes", and commas', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-01-01T01:00:00Z', 'note with\nnewline');
    const csv = exportSessions('csv');
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,name,status');
    expect(lines[1]).toContain('has ""quotes""');
  });
});

// ── Recovery ──────────────────────────────────────────────

describe('Recovery', () => {
  it('recoverStaleSessions closes old active sessions', () => {
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    createSession({ name: 'stale', startTime: old, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const recovered = recoverStaleSessions(24);
    expect(recovered.length).toBe(1);
    expect(recovered[0].name).toBe('stale');
    expect(getActiveSession()).toBeNull();
  });

  it('does not recover recent sessions', () => {
    createSession({ name: 'recent', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const recovered = recoverStaleSessions(24);
    expect(recovered.length).toBe(0);
    expect(getActiveSession()).not.toBeNull();
  });
});

// ── Pricing ───────────────────────────────────────────────

describe('Pricing', () => {
  it('loadPricing returns defaults', () => {
    const p = loadPricing();
    expect(p['claude-sonnet-4']).toBeDefined();
    expect(p['gpt-4o']).toBeDefined();
    expect(p['claude-sonnet-4'].input).toBe(3);
  });

  it('setPricing adds custom pricing that persists', () => {
    setPricing('custom-model', 5, 10);
    const p = loadPricing();
    expect(p['custom-model']).toEqual({ input: 5, output: 10 });
  });

  it('resetPricing removes custom overrides', () => {
    setPricing('temp-model', 1, 2);
    resetPricing();
    const p = loadPricing();
    expect(p['temp-model']).toBeUndefined();
  });

  it('loadPricing blocks prototype pollution keys', () => {
    // Manually write a malicious pricing file
    const { writeFileSync } = require('fs');
    writeFileSync(getPricingPath(), JSON.stringify({ '__proto__': { input: 999, output: 999 }, 'constructor': { input: 1, output: 1 }, 'legit-model': { input: 2, output: 3 } }));
    const p = loadPricing();
    expect(p['legit-model']).toEqual({ input: 2, output: 3 });
    expect(Object.hasOwn(p, '__proto__')).toBe(false);
    expect(Object.hasOwn(p, 'constructor')).toBe(false);
    resetPricing();
  });
});

// ── Pagination ────────────────────────────────────────────

describe('Pagination', () => {
  it('getSessionsPaginated returns correct page', () => {
    for (let i = 0; i < 5; i++) {
      createSession({ name: `p${i}`, startTime: `2025-01-0${i + 1}T00:00:00Z`, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    }
    const page = getSessionsPaginated({ limit: 2, offset: 0 });
    expect(page.sessions.length).toBe(2);
    expect(page.total).toBe(5);
  });

  it('getSessionsPaginated filters by status', () => {
    const id = createSession({ name: 'done', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, '2025-01-01T01:00:00Z');
    createSession({ name: 'active', startTime: '2025-01-02T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const completed = getSessionsPaginated({ status: 'completed' });
    expect(completed.total).toBe(1);
    expect(completed.sessions[0].name).toBe('done');
  });

  it('getSessionsPaginated filters by search', () => {
    createSession({ name: 'refactor-auth', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'fix-bug', startTime: '2025-01-02T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const result = getSessionsPaginated({ search: 'refactor' });
    expect(result.total).toBe(1);
  });
});

// ── Session Detail ────────────────────────────────────────

describe('Session Detail', () => {
  it('getSessionDetail returns full session data', () => {
    const id = createSession({ name: 'detail', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addFileChange({ sessionId: id, filePath: 'a.ts', changeType: 'modified', timestamp: '2025-01-01T00:01:00Z' });
    addCommit({ sessionId: id, hash: 'abc', message: 'msg', timestamp: '2025-01-01T00:02:00Z' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 50, cost: 0.01, timestamp: '2025-01-01T00:03:00Z' });
    addNote(id, 'hello');
    const d = getSessionDetail(id);
    expect(d).not.toBeNull();
    expect(d!.files.length).toBe(1);
    expect(d!.commits.length).toBe(1);
    expect(d!.aiUsage.length).toBe(1);
    expect(d!.notes.length).toBe(1);
  });

  it('getSessionDetail returns null for unknown ID', () => {
    expect(getSessionDetail(99999)).toBeNull();
  });
});

// ── Dashboard Queries ─────────────────────────────────────

describe('Dashboard Queries', () => {
  function seedData() {
    const id = createSession({ name: 'dash', startTime: new Date().toISOString(), workingDirectory: '/project', gitRoot: '/project', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'anthropic', model: 'claude-sonnet-4', tokens: 1000, promptTokens: 700, completionTokens: 300, cost: 0.006, agentName: 'TestAgent', timestamp: new Date().toISOString() });
    addFileChange({ sessionId: id, filePath: 'src/index.ts', changeType: 'modified', timestamp: new Date().toISOString() });
    addCommit({ sessionId: id, hash: 'abc1234', message: 'fix', timestamp: new Date().toISOString() });
    endSession(id, new Date().toISOString());
    return id;
  }

  it('getDailyCosts returns array', () => {
    seedData();
    const costs = getDailyCosts(30);
    expect(Array.isArray(costs)).toBe(true);
  });

  it('getModelBreakdown groups by provider and model', () => {
    seedData();
    const breakdown = getModelBreakdown();
    expect(breakdown.length).toBeGreaterThan(0);
    expect(breakdown[0].provider).toBe('anthropic');
    expect(breakdown[0].model).toBe('claude-sonnet-4');
  });

  it('getTopSessions returns sessions sorted by cost', () => {
    seedData();
    const top = getTopSessions(10);
    expect(top.length).toBeGreaterThan(0);
  });

  it('getProviderBreakdown groups by provider', () => {
    seedData();
    const pb = getProviderBreakdown();
    expect(pb.length).toBeGreaterThan(0);
    expect(pb[0].provider).toBe('anthropic');
  });

  it('getFileHotspots returns changed files', () => {
    seedData();
    const fh = getFileHotspots();
    expect(fh.length).toBeGreaterThan(0);
    expect(fh[0].filePath).toBe('src/index.ts');
  });

  it('getActivityHeatmap returns array', () => {
    seedData();
    expect(Array.isArray(getActivityHeatmap())).toBe(true);
  });

  it('getDailyTokens returns token breakdown', () => {
    seedData();
    const dt = getDailyTokens(30);
    expect(Array.isArray(dt)).toBe(true);
  });

  it('getCostVelocity computes cost per hour', () => {
    seedData();
    const cv = getCostVelocity();
    expect(Array.isArray(cv)).toBe(true);
  });

  it('getProjectBreakdown groups by project', () => {
    seedData();
    const pb = getProjectBreakdown();
    expect(pb.length).toBeGreaterThan(0);
    expect(pb[0].project).toBe('/project');
  });

  it('getTokenRatios computes prompt:completion ratio', () => {
    seedData();
    const tr = getTokenRatios();
    expect(tr.length).toBeGreaterThan(0);
    expect(tr[0].ratio).toBeGreaterThan(0);
  });
});

// ── clearAllData ──────────────────────────────────────────

describe('clearAllData', () => {
  it('removes all sessions and related data', () => {
    const id = createSession({ name: 'gone', startTime: '2025-01-01T00:00:00Z', workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addNote(id, 'bye');
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 10, cost: 0.01, timestamp: '2025-01-01T00:01:00Z' });
    clearAllData();
    expect(getSessions(100).length).toBe(0);
    expect(getStats().totalSessions).toBe(0);
  });
});
