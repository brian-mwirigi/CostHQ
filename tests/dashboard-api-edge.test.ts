import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  clearAllData, createSession, addAIUsage, addFileChange,
  addCommit, endSession, addNote, addFeedback, getFeedback,
} from '../src/db';

vi.mock('../src/git', () => ({
  initGit: vi.fn(),
  startGitPolling: vi.fn(),
  stopGitPolling: vi.fn(),
  checkForNewCommits: vi.fn(),
  cleanupGit: vi.fn(),
  getGitRoot: vi.fn().mockResolvedValue(null),
  getGitHead: vi.fn().mockResolvedValue(null),
  getGitInfo: vi.fn().mockResolvedValue(null),
  getGitDiffFiles: vi.fn().mockResolvedValue([]),
  getGitLogCommits: vi.fn().mockResolvedValue([]),
  getGitDiff: vi.fn().mockResolvedValue('@@ -1 +1 @@\n-old\n+new'),
  getCommitDiff: vi.fn().mockResolvedValue('commit diff content'),
  getGitDiffStats: vi.fn().mockResolvedValue([
    { filePath: 'src/test.ts', additions: 10, deletions: 3 },
  ]),
}));

vi.mock('../src/watcher', () => ({
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  cleanupWatcher: vi.fn(),
}));

import { buildApiRouter } from '../src/dashboard-server';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api/v1', buildApiRouter());
  return app;
}

let app: express.Express;

beforeEach(() => {
  clearAllData();
  app = createTestApp();
});

describe('GET /api/v1/stats', () => {
  it('returns zeros for empty database', async () => {
    const res = await request(app).get('/api/v1/stats');
    expect(res.status).toBe(200);
    expect(res.body.totalSessions).toBe(0);
    expect(res.body.totalAICost).toBe(0);
    expect(res.body.totalTime).toBe(0);
    expect(res.body.activeSessions).toBe(0);
  });

  it('includes activeSessions count', async () => {
    createSession({ name: 'a', startTime: new Date().toISOString(), workingDirectory: '/a', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    createSession({ name: 'b', startTime: new Date().toISOString(), workingDirectory: '/b', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const res = await request(app).get('/api/v1/stats');
    expect(res.body.activeSessions).toBe(2);
  });
});

describe('GET /api/v1/sessions', () => {
  it('defaults to limit=50 when no query params', async () => {
    for (let i = 0; i < 60; i++) {
      const id = createSession({ name: `s${i}`, startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
      endSession(id, new Date().toISOString());
    }
    const res = await request(app).get('/api/v1/sessions');
    expect(res.body.total).toBe(60);
    expect(res.body.sessions.length).toBe(50);
  });

  it('handles empty search gracefully', async () => {
    const id = createSession({ name: 'hello', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, new Date().toISOString());
    const res = await request(app).get('/api/v1/sessions?search=');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('returns empty results when no sessions exist', async () => {
    const res = await request(app).get('/api/v1/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('handles invalid limit gracefully', async () => {
    const res = await request(app).get('/api/v1/sessions?limit=abc');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/sessions/:id', () => {
  it('returns 400 for non-numeric ID', async () => {
    const res = await request(app).get('/api/v1/sessions/notanumber');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid session ID');
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app).get('/api/v1/sessions/99999');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Session not found');
  });

  it('returns full session detail with all related data', async () => {
    const id = createSession({ name: 'full', startTime: new Date().toISOString(), workingDirectory: '/proj', gitRoot: '/proj', startGitHead: 'abc123def456', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'test', model: 'test-model', tokens: 100, promptTokens: 60, completionTokens: 40, cost: 0.001, timestamp: new Date().toISOString() });
    addFileChange({ sessionId: id, filePath: 'x.ts', changeType: 'modified', timestamp: new Date().toISOString() });
    addCommit({ sessionId: id, hash: 'hash123', message: 'msg', timestamp: new Date().toISOString() });
    addNote(id, 'note1');
    endSession(id, new Date().toISOString());

    const res = await request(app).get(`/api/v1/sessions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.session.name).toBe('full');
    expect(res.body.session.startGitHead).toBe('abc123def456');
    expect(res.body.session.endTime).not.toBeNull();
    expect(res.body.aiUsage.length).toBe(1);
    expect(res.body.files.length).toBe(1);
    expect(res.body.commits.length).toBe(1);
    expect(res.body.notes.length).toBe(1);
  });
});

describe('GET /api/v1/sessions/:id/diff', () => {
  it('returns 400 for invalid session ID', async () => {
    const res = await request(app).get('/api/v1/sessions/notanumber/diff');
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app).get('/api/v1/sessions/99999/diff');
    expect(res.status).toBe(404);
  });

  it('returns 400 when session has no gitRoot', async () => {
    const id = createSession({ name: 'no-git', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, new Date().toISOString());
    const res = await request(app).get(`/api/v1/sessions/${id}/diff`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('no git repository');
  });

  it('returns 400 when session has no startGitHead', async () => {
    const id = createSession({ name: 'no-head', startTime: new Date().toISOString(), workingDirectory: '/w', gitRoot: '/repo', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, new Date().toISOString());
    const res = await request(app).get(`/api/v1/sessions/${id}/diff`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('no start git HEAD');
  });
});

describe('GET /api/v1/sessions/:id/commits/:hash/diff', () => {
  it('returns 400 for invalid session ID', async () => {
    const res = await request(app).get('/api/v1/sessions/abc/commits/deadbeef/diff');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid commit hash (too short)', async () => {
    const id = createSession({ name: 'diff-test', startTime: new Date().toISOString(), workingDirectory: '/w', gitRoot: '/repo', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, new Date().toISOString());
    const res = await request(app).get(`/api/v1/sessions/${id}/commits/abc/diff`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid commit hash');
  });

  it('returns 400 for invalid commit hash (special chars)', async () => {
    const id = createSession({ name: 'diff-test2', startTime: new Date().toISOString(), workingDirectory: '/w', gitRoot: '/repo', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, new Date().toISOString());
    const res = await request(app).get(`/api/v1/sessions/${id}/commits/.../diff`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent session with valid hash format', async () => {
    const res = await request(app).get('/api/v1/sessions/99999/commits/abc1234/diff');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/sessions/:id/diff-stats', () => {
  it('returns 400 for invalid session ID', async () => {
    const res = await request(app).get('/api/v1/sessions/nan/diff-stats');
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app).get('/api/v1/sessions/99999/diff-stats');
    expect(res.status).toBe(404);
  });

  it('returns empty array when session has no git info', async () => {
    const id = createSession({ name: 'no-git', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, new Date().toISOString());
    const res = await request(app).get(`/api/v1/sessions/${id}/diff-stats`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/v1/reset', () => {
  it('requires exact X-Confirm-Reset header value', async () => {
    const res = await request(app)
      .post('/api/v1/reset')
      .set('X-Confirm-Reset', 'maybe');
    expect(res.status).toBe(400);
  });

  it('clears all data and returns ok', async () => {
    createSession({ name: 'to-delete', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    const res = await request(app).post('/api/v1/reset').set('X-Confirm-Reset', 'yes');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /api/v1/feedback', () => {
  it('rejects empty message', async () => {
    const res = await request(app).post('/api/v1/feedback').send({ type: 'bug', message: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Message is required');
  });

  it('rejects missing message field', async () => {
    const res = await request(app).post('/api/v1/feedback').send({ type: 'bug' });
    expect(res.status).toBe(400);
  });

  it('rejects whitespace-only message', async () => {
    const res = await request(app).post('/api/v1/feedback').send({ type: 'bug', message: '   ' });
    expect(res.status).toBe(400);
  });

  it('accepts valid feedback', async () => {
    const res = await request(app).post('/api/v1/feedback').send({
      type: 'feature',
      message: 'Add dark mode support',
      email: 'user@example.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeGreaterThan(0);
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('defaults type to general for invalid types', async () => {
    const res = await request(app).post('/api/v1/feedback').send({
      type: 'invalid_type',
      message: 'Test message',
    });
    expect(res.status).toBe(200);
    const feedbacks = getFeedback(1);
    expect(feedbacks[0].type).toBe('general');
  });

  it('truncates very long messages', async () => {
    const longMsg = 'x'.repeat(6000);
    const res = await request(app).post('/api/v1/feedback').send({
      type: 'general',
      message: longMsg,
    });
    expect(res.status).toBe(200);
    const feedbacks = getFeedback(1);
    expect(feedbacks[0].message.length).toBeLessThanOrEqual(5000);
  });
});

describe('POST /api/v1/license/activate', () => {
  it('rejects missing key', async () => {
    const res = await request(app).post('/api/v1/license/activate').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects empty key', async () => {
    const res = await request(app).post('/api/v1/license/activate').send({ key: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/lead', () => {
  it('rejects missing email', async () => {
    const res = await request(app).post('/api/v1/lead').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid email');
  });

  it('rejects email without @', async () => {
    const res = await request(app).post('/api/v1/lead').send({ email: 'notanemail' });
    expect(res.status).toBe(400);
  });

  it('rejects empty email', async () => {
    const res = await request(app).post('/api/v1/lead').send({ email: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/export', () => {
  it('defaults to JSON when no format specified', async () => {
    const id = createSession({ name: 'default-export', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, new Date().toISOString());
    const res = await request(app).get('/api/v1/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('does not crash for invalid format (defaults to JSON)', async () => {
    const id = createSession({ name: 'bad-format', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    endSession(id, new Date().toISOString());
    const res = await request(app).get('/api/v1/export?format=xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
  });
});

describe('GET /api/v1/daily-tokens', () => {
  it('defaults to 30 days when not specified', async () => {
    const id = createSession({ name: 'token-test', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 100, promptTokens: 70, completionTokens: 30, cost: 0.01, timestamp: new Date().toISOString() });
    endSession(id, new Date().toISOString());
    const res = await request(app).get('/api/v1/daily-tokens');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('handles non-numeric days parameter', async () => {
    const res = await request(app).get('/api/v1/daily-tokens?days=abc');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/v1/cost-velocity', () => {
  it('defaults limit to 50', async () => {
    const id = createSession({ name: 'vel-test', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 100, cost: 0.01, timestamp: new Date().toISOString() });
    endSession(id, new Date(Date.now() + 3600000).toISOString());
    const res = await request(app).get('/api/v1/cost-velocity');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/v1/file-hotspots', () => {
  it('defaults limit to 50', async () => {
    const id = createSession({ name: 'hotspot-test', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addFileChange({ sessionId: id, filePath: 'src/a.ts', changeType: 'modified', timestamp: new Date().toISOString() });
    endSession(id, new Date().toISOString());
    const res = await request(app).get('/api/v1/file-hotspots');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

describe('API version header', () => {
  it('all API responses include X-Codesession-Api-Version header', async () => {
    const res = await request(app).get('/api/v1/stats');
    expect(res.headers['x-codesession-api-version']).toBe('1');
  });
});

describe('CSRF edge cases', () => {
  it('blocks cross-origin via Referer header', async () => {
    const res = await request(app)
      .post('/api/v1/reset')
      .set('Referer', 'https://evil.com')
      .set('X-Confirm-Reset', 'yes');
    expect(res.status).toBe(403);
  });

  it('allows GET requests without origin check', async () => {
    const res = await request(app)
      .get('/api/v1/stats')
      .set('Origin', 'https://evil.com');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/feedback', () => {
  it('returns empty array when no feedback', async () => {
    const res = await request(app).get('/api/v1/feedback');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns stored feedback', async () => {
    addFeedback({ type: 'bug', message: 'crash' });
    addFeedback({ type: 'feature', message: 'new thing' });
    const res = await request(app).get('/api/v1/feedback');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});

describe('JSON parse errors', () => {
  it('returns 400 for malformed JSON in POST body', async () => {
    const res = await request(app)
      .post('/api/v1/feedback')
      .set('Content-Type', 'application/json')
      .send('{invalid json');
    expect(res.status).toBe(400);
  });
});