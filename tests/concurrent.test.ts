import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession, getSession, getActiveSession, getActiveSessions,
  endSession, addAIUsage, addFileChange, addCommit,
  getAIUsage, getFileChanges, getCommits, getStats,
  clearAllData, recoverStaleSessions, getSessionsPaginated,
  addNote, getNotes, ensureTrackingSession,
} from '../src/db';

beforeEach(() => { clearAllData(); });

// ════════════════════════════════════════════════════════════════
// CONCURRENT ADD OPERATIONS WITHIN A SINGLE THREAD
// better-sqlite3 is synchronous, so true parallel writes aren't
// possible in one Node.js thread. But we can verify that multiple
// sequential rapid operations don't corrupt state.
// ════════════════════════════════════════════════════════════════

describe('Concurrent AI Usage Accumulation', () => {
  it('handles 1000 rapid addAIUsage calls without corruption', () => {
    const id = createSession({ name: 'bulk-ai', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const totalCost = 0.005 * 1000; // $5.00
    let cumulativeTokens = 0;

    for (let i = 0; i < 1000; i++) {
      addAIUsage({ sessionId: id, provider: 'openai', model: 'gpt-4o-mini', tokens: 100, promptTokens: 70, completionTokens: 30, cost: 0.005, timestamp: new Date().toISOString() });
      cumulativeTokens += 100;
    }

    const s = getSession(id);
    expect(s!.aiTokens).toBe(100000);
    expect(s!.aiCost).toBeCloseTo(5.0, 1);
    expect(getAIUsage(id).length).toBe(1000);
  });

  it('handles 500 rapid addFileChange calls with unique paths', () => {
    const id = createSession({ name: 'bulk-files', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    for (let i = 0; i < 500; i++) {
      addFileChange({ sessionId: id, filePath: `src/file_${i}.ts`, changeType: 'modified', timestamp: new Date().toISOString() });
    }

    const s = getSession(id);
    expect(s!.filesChanged).toBe(500);
    expect(getFileChanges(id).length).toBe(500);
  });

  it('handles 200 rapid addCommit calls', () => {
    const id = createSession({ name: 'bulk-commits', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    for (let i = 0; i < 200; i++) {
      addCommit({ sessionId: id, hash: `hash${String(i).padStart(4, '0')}`, message: `commit ${i}`, timestamp: new Date().toISOString() });
    }

    expect(getSession(id)!.commits).toBe(200);
    expect(getCommits(id).length).toBe(200);
  });

  it('interleaves addAIUsage, addFileChange, and addCommit without corruption', () => {
    const id = createSession({ name: 'interleaved', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    for (let i = 0; i < 100; i++) {
      addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 10, cost: 0.001, timestamp: new Date().toISOString() });
      addFileChange({ sessionId: id, filePath: `file_${i}.ts`, changeType: 'modified', timestamp: new Date().toISOString() });
      addCommit({ sessionId: id, hash: `hash_${i}`, message: `msg_${i}`, timestamp: new Date().toISOString() });
    }

    const s = getSession(id);
    expect(s!.aiTokens).toBe(1000);
    expect(s!.filesChanged).toBe(100);
    expect(s!.commits).toBe(100);
    expect(getAIUsage(id).length).toBe(100);
    expect(getFileChanges(id).length).toBe(100);
    expect(getCommits(id).length).toBe(100);
  });
});

// ════════════════════════════════════════════════════════════════
// SIMULTANEOUS SESSIONS (MULTIPLE ACTIVE)
// ════════════════════════════════════════════════════════════════

describe('Multiple simultaneous active sessions', () => {
  it('tracks file changes independently across sessions', () => {
    const id1 = createSession({ name: 's1', startTime: new Date().toISOString(), workingDirectory: '/a', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const id2 = createSession({ name: 's2', startTime: new Date().toISOString(), workingDirectory: '/b', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    addFileChange({ sessionId: id1, filePath: 'a.ts', changeType: 'modified', timestamp: new Date().toISOString() });
    addFileChange({ sessionId: id2, filePath: 'b.ts', changeType: 'created', timestamp: new Date().toISOString() });

    expect(getFileChanges(id1).length).toBe(1);
    expect(getFileChanges(id2).length).toBe(1);
    expect(getFileChanges(id1)[0].filePath).toBe('a.ts');
    expect(getFileChanges(id2)[0].filePath).toBe('b.ts');
  });

  it('tracks AI usage independently across sessions', () => {
    const id1 = createSession({ name: 's1', startTime: new Date().toISOString(), workingDirectory: '/a', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const id2 = createSession({ name: 's2', startTime: new Date().toISOString(), workingDirectory: '/b', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    addAIUsage({ sessionId: id1, provider: 'openai', model: 'gpt-4o', tokens: 500, cost: 0.005, timestamp: new Date().toISOString() });
    addAIUsage({ sessionId: id2, provider: 'anthropic', model: 'claude-sonnet-4', tokens: 1000, cost: 0.006, timestamp: new Date().toISOString() });

    expect(getSession(id1)!.aiTokens).toBe(500);
    expect(getSession(id2)!.aiTokens).toBe(1000);
    expect(getSession(id1)!.aiCost).toBeCloseTo(0.005, 4);
    expect(getSession(id2)!.aiCost).toBeCloseTo(0.006, 4);
  });

  it('getStats correctly aggregates across independently ended sessions', () => {
    const id1 = createSession({ name: 'a', startTime: '2025-01-01T10:00:00Z', workingDirectory: '/a', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id1, provider: 'p', model: 'm', tokens: 100, cost: 1.0, timestamp: '2025-01-01T10:01:00Z' });
    endSession(id1, '2025-01-01T11:00:00Z'); // 1h

    const id2 = createSession({ name: 'b', startTime: '2025-01-01T12:00:00Z', workingDirectory: '/b', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id2, provider: 'p', model: 'm', tokens: 200, cost: 2.0, timestamp: '2025-01-01T12:01:00Z' });
    endSession(id2, '2025-01-01T14:00:00Z'); // 2h

    const stats = getStats();
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalTime).toBe(3600 + 7200);
    expect(stats.totalAICost).toBeCloseTo(3.0, 2);
  });
});

// ════════════════════════════════════════════════════════════════
// ensureTrackingSession CONCURRENT
// ════════════════════════════════════════════════════════════════

describe('ensureTrackingSession idempotency', () => {
  it('returns same ID for repeated calls on same directory', () => {
    const ids = new Set<number>();
    for (let i = 0; i < 50; i++) {
      ids.add(ensureTrackingSession('/same-dir'));
    }
    // All calls should return the same session ID
    expect(ids.size).toBe(1);
    expect(getActiveSessions().length).toBe(1);
  });

  it('creates distinct sessions for distinct directories', () => {
    const id1 = ensureTrackingSession('/dir-a');
    const id2 = ensureTrackingSession('/dir-b');
    const id3 = ensureTrackingSession('/dir-c');
    expect(new Set([id1, id2, id3]).size).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════
// RAPID CREATE → END → CREATE IN SAME DIRECTORY (SESSION RECYCLING)
// ════════════════════════════════════════════════════════════════

describe('Session lifecycle rapid cycling', () => {
  it('create-end-create in same directory yields distinct sessions', () => {
    const id1 = createSession({ name: 'cycle-1', startTime: '2025-01-01T10:00:00Z', workingDirectory: '/cycle', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id1, '2025-01-01T11:00:00Z');
    const id2 = createSession({ name: 'cycle-2', startTime: '2025-01-01T12:00:00Z', workingDirectory: '/cycle', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id2, '2025-01-01T13:00:00Z');
    const id3 = createSession({ name: 'cycle-3', startTime: '2025-01-01T14:00:00Z', workingDirectory: '/cycle', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    expect(id2).not.toBe(id1);
    expect(id3).not.toBe(id2);
    expect(getSession(id1)!.status).toBe('completed');
    expect(getSession(id2)!.status).toBe('completed');
    expect(getSession(id3)!.status).toBe('active');
  });

  it('data isolation across cycled sessions', () => {
    const id1 = createSession({ name: 'iso-1', startTime: '2025-01-01T10:00:00Z', workingDirectory: '/iso', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id1, provider: 'p', model: 'm', tokens: 100, cost: 0.01, timestamp: '2025-01-01T10:01:00Z' });
    addFileChange({ sessionId: id1, filePath: 'a.ts', changeType: 'modified', timestamp: '2025-01-01T10:02:00Z' });
    endSession(id1, '2025-01-01T11:00:00Z');

    const id2 = createSession({ name: 'iso-2', startTime: '2025-01-01T12:00:00Z', workingDirectory: '/iso', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id2, provider: 'p', model: 'm2', tokens: 200, cost: 0.02, timestamp: '2025-01-01T12:01:00Z' });

    // Session 1 should still have its isolated data
    expect(getSession(id1)!.aiTokens).toBe(100);
    expect(getFileChanges(id1).length).toBe(1);
    // Session 2 should have its own
    expect(getSession(id2)!.aiTokens).toBe(200);
    expect(getFileChanges(id2).length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// RECOVERY WITH MULTIPLE STALE SESSIONS
// ════════════════════════════════════════════════════════════════

describe('Bulk recovery', () => {
  it('recovers multiple stale sessions at once', () => {
    const old1 = new Date(Date.now() - 72 * 3600_000).toISOString();
    const old2 = new Date(Date.now() - 96 * 3600_000).toISOString();
    const old3 = new Date(Date.now() - 120 * 3600_000).toISOString();
    createSession({ name: 'stale1', startTime: old1, workingDirectory: '/a', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'stale2', startTime: old2, workingDirectory: '/b', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'stale3', startTime: old3, workingDirectory: '/c', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    const recovered = recoverStaleSessions(24);
    expect(recovered.length).toBe(3);
    expect(getActiveSessions().length).toBe(0);
    expect(getSessionsPaginated({ status: 'completed' }).total).toBe(3);
  });

  it('recovers only sessions older than threshold', () => {
    const veryOld = new Date(Date.now() - 72 * 3600_000).toISOString();
    const recent = new Date(Date.now() - 1 * 3600_000).toISOString();
    createSession({ name: 'stale', startTime: veryOld, workingDirectory: '/old', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'fresh', startTime: recent, workingDirectory: '/new', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    const recovered = recoverStaleSessions(24);
    expect(recovered.length).toBe(1);
    expect(recovered[0].name).toBe('stale');
    // fresh session should still be active
    expect(getActiveSessions().length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// PAGINATION BOUNDARY CONDITIONS
// ════════════════════════════════════════════════════════════════

describe('Pagination boundary conditions', () => {
  it('handles limit=0 gracefully', () => {
    createSession({ name: 'test', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const result = getSessionsPaginated({ limit: 0, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.sessions.length).toBe(0);
  });

  it('handles limit larger than total', () => {
    for (let i = 0; i < 3; i++) {
      createSession({ name: `s${i}`, startTime: `2025-01-0${i + 1}T00:00:00Z`, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    }
    const result = getSessionsPaginated({ limit: 1000, offset: 0 });
    expect(result.sessions.length).toBe(3);
    expect(result.total).toBe(3);
  });

  it('last page with remainder', () => {
    for (let i = 0; i < 7; i++) {
      createSession({ name: `s${i}`, startTime: `2025-01-0${i + 1}T00:00:00Z`, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    }
    // Page 3 with limit=3: offset=6, should get 1 remaining
    const result = getSessionsPaginated({ limit: 3, offset: 6 });
    expect(result.total).toBe(7);
    expect(result.sessions.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// NOTES WITH RAPID ADDITION
// ════════════════════════════════════════════════════════════════

describe('Notes rapid addition', () => {
  it('preserves insertion order in retrieval', () => {
    const id = createSession({ name: 'notes-order', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

    for (let i = 0; i < 50; i++) {
      addNote(id, `note-${i}`);
    }

    const notes = getNotes(id);
    expect(notes.length).toBe(50);
    expect(notes[0].message).toBe('note-0');
    expect(notes[49].message).toBe('note-49');
  });
});

// ════════════════════════════════════════════════════════════════
// WAL MODE & BUSY TIMEOUT VERIFICATION
// ════════════════════════════════════════════════════════════════

describe('WAL mode behavior', () => {
  it('database survives rapid alternating writes', () => {
    // This test exercises WAL mode by performing rapid alternating write operations
    for (let cycle = 0; cycle < 5; cycle++) {
      const id = createSession({ name: `wal-${cycle}`, startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });

      for (let i = 0; i < 20; i++) {
        addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 1, cost: 0.0001, timestamp: new Date().toISOString() });
        addFileChange({ sessionId: id, filePath: `f${i}.ts`, changeType: 'modified', timestamp: new Date().toISOString() });
        addNote(id, `note-${i}`);
      }

      endSession(id, new Date().toISOString());
    }

    // If we got here without a SQLITE_BUSY or corruption error, WAL is working
    const stats = getStats();
    expect(stats.totalSessions).toBe(5);
  });

  it('getSessionsPaginated works correctly after heavy writes', () => {
    for (let i = 0; i < 100; i++) {
      createSession({ name: `heavy-${i}`, startTime: `2025-01-01T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    }

    const page1 = getSessionsPaginated({ limit: 33, offset: 0 });
    expect(page1.total).toBe(100);
    expect(page1.sessions.length).toBe(33);

    const page2 = getSessionsPaginated({ limit: 33, offset: 33 });
    expect(page2.sessions.length).toBe(33);

    const page3 = getSessionsPaginated({ limit: 33, offset: 66 });
    expect(page3.sessions.length).toBe(33);

    const page4 = getSessionsPaginated({ limit: 33, offset: 99 });
    expect(page4.sessions.length).toBe(1);
  });
});