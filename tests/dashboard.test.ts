import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { clearAllData, createSession, addAIUsage, addFileChange, addCommit, endSession, addNote } from '../src/db';

// Mock git module to avoid real git operations in dashboard routes
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
  getGitDiff: vi.fn().mockResolvedValue(''),
  getCommitDiff: vi.fn().mockResolvedValue(''),
  getGitDiffStats: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/watcher', () => ({
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  cleanupWatcher: vi.fn(),
}));

import { buildApiRouter } from '../src/dashboard-server';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '4kb' }));
  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  // CSRF protection
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    if (origin.startsWith('http://localhost:3737') || origin.startsWith('http://127.0.0.1:3737')) return next();
    res.status(403).json({ error: 'CSRF' });
  });
  app.use('/api/v1', buildApiRouter());
  return app;
}

let app: express.Express;

beforeEach(() => {
  clearAllData();
  app = createTestApp();
});

function seedSession() {
  const id = createSession({ name: 'seed', startTime: new Date().toISOString(), workingDirectory: '/proj', gitRoot: '/proj', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
  addAIUsage({ sessionId: id, provider: 'anthropic', model: 'claude-sonnet-4', tokens: 1000, promptTokens: 700, completionTokens: 300, cost: 0.006, agentName: 'Bot', timestamp: new Date().toISOString() });
  addFileChange({ sessionId: id, filePath: 'src/a.ts', changeType: 'modified', timestamp: new Date().toISOString() });
  addCommit({ sessionId: id, hash: 'abc1234', message: 'fix', timestamp: new Date().toISOString() });
  addNote(id, 'test note');
  endSession(id, new Date().toISOString());
  return id;
}

// ── API Endpoints ─────────────────────────────────────────

describe('GET /api/v1/stats', () => {
  it('returns stats object', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/stats');
    expect(res.status).toBe(200);
    expect(res.body.totalSessions).toBe(1);
    expect(res.body).toHaveProperty('totalAICost');
    expect(res.body).toHaveProperty('activeSessions');
  });
});

describe('GET /api/v1/sessions', () => {
  it('returns paginated sessions', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBe(1);
    expect(res.body.total).toBe(1);
  });

  it('respects limit and offset', async () => {
    seedSession(); seedSession();
    const res = await request(app).get('/api/v1/sessions?limit=1&offset=0');
    expect(res.body.sessions.length).toBe(1);
    expect(res.body.total).toBe(2);
  });
});

describe('GET /api/v1/sessions/:id', () => {
  it('returns session detail', async () => {
    const id = seedSession();
    const res = await request(app).get(`/api/v1/sessions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.session.name).toBe('seed');
    expect(res.body.files.length).toBe(1);
    expect(res.body.commits.length).toBe(1);
    expect(res.body.aiUsage.length).toBe(1);
    expect(res.body.notes.length).toBe(1);
  });

  it('returns 400 for invalid ID', async () => {
    const res = await request(app).get('/api/v1/sessions/notanumber');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown ID', async () => {
    const res = await request(app).get('/api/v1/sessions/99999');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/daily-costs', () => {
  it('returns daily cost array', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/daily-costs?days=30');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/v1/model-breakdown', () => {
  it('returns model breakdown', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/model-breakdown');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/top-sessions', () => {
  it('returns top sessions by cost', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/top-sessions');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/provider-breakdown', () => {
  it('returns provider breakdown', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/provider-breakdown');
    expect(res.status).toBe(200);
    expect(res.body[0].provider).toBe('anthropic');
  });
});

describe('GET /api/v1/file-hotspots', () => {
  it('returns file hotspots', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/file-hotspots');
    expect(res.status).toBe(200);
    expect(res.body[0].filePath).toBe('src/a.ts');
  });
});

describe('GET /api/v1/activity-heatmap', () => {
  it('returns heatmap data', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/activity-heatmap');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/v1/daily-tokens', () => {
  it('returns daily token data', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/daily-tokens');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/cost-velocity', () => {
  it('returns cost velocity', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/cost-velocity');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/projects', () => {
  it('returns project breakdown', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(200);
    expect(res.body[0].project).toBe('/proj');
  });
});

describe('GET /api/v1/token-ratios', () => {
  it('returns token ratios', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/token-ratios');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/pricing', () => {
  it('returns pricing table', async () => {
    const res = await request(app).get('/api/v1/pricing');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('claude-sonnet-4');
  });
});

describe('GET /api/v1/export', () => {
  it('exports JSON', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/export?format=json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('exports CSV', async () => {
    seedSession();
    const res = await request(app).get('/api/v1/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });
});

describe('GET /api/v1/version', () => {
  it('returns version info', async () => {
    const res = await request(app).get('/api/v1/version');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('apiVersion');
  });
});

// ── Security ──────────────────────────────────────────────

describe('POST /api/v1/reset', () => {
  it('rejects without X-Confirm-Reset header', async () => {
    const res = await request(app).post('/api/v1/reset');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('X-Confirm-Reset');
  });

  it('succeeds with X-Confirm-Reset header', async () => {
    seedSession();
    const res = await request(app).post('/api/v1/reset').set('X-Confirm-Reset', 'yes');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Verify data is actually cleared
    const statsRes = await request(app).get('/api/v1/stats');
    expect(statsRes.body.totalSessions).toBe(0);
  });
});

describe('CSRF Protection', () => {
  it('blocks cross-origin POST requests', async () => {
    const res = await request(app)
      .post('/api/v1/reset')
      .set('Origin', 'https://evil.com')
      .set('X-Confirm-Reset', 'yes');
    expect(res.status).toBe(403);
  });

  it('allows same-origin POST requests', async () => {
    const res = await request(app)
      .post('/api/v1/reset')
      .set('Origin', 'http://localhost:3737')
      .set('X-Confirm-Reset', 'yes');
    expect(res.status).toBe(200);
  });

  it('allows POST without Origin header (curl/server)', async () => {
    const res = await request(app)
      .post('/api/v1/reset')
      .set('X-Confirm-Reset', 'yes');
    expect(res.status).toBe(200);
  });
});

describe('Security Headers', () => {
  it('sets security headers on responses', async () => {
    const res = await request(app).get('/api/v1/stats');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});
