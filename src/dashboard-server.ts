import express, { Request, Response, NextFunction, Router } from 'express';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { createServer } from 'net';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import {
  getStats, getActiveSessions,
  getSessionsPaginated, getSessionDetail,
  getDailyCosts, getModelBreakdown, getTopSessions,
  exportSessions, loadPricing,
  getProviderBreakdown, getFileHotspots, getActivityHeatmap,
  getDailyTokens, getCostVelocity, getProjectBreakdown, getTokenRatios,
  getSession, getCommits, clearAllData,
  addFeedback, getFeedback,
  createSession, endSession, addAIUsage, getActiveSessionForDir
} from './db';
import { getGitDiff, getCommitDiff, getGitDiffStats, getGitRoot, getGitHead, initGit, startGitPolling, stopGitPolling } from './git';
import { getLicense, activateLicense, deactivateLicense } from '../pro/src/license';
import { getProOpsSummary } from '../pro/src/policies';
import { startWatcher, stopWatcher } from './watcher';

interface DashboardOptions {
  port?: number;
  open?: boolean;
  host?: string;
  json?: boolean;
}

// ── PID file management ────────────────────────────────────

const PID_DIR = join(homedir(), '.codesession');
const pidFilePath = (port: number) => join(PID_DIR, `dashboard-${port}.pid`);

function writePidFile(port: number): void {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(pidFilePath(port), `${process.pid}\n`, 'utf-8');
}

function removePidFile(port: number): void {
  try { unlinkSync(pidFilePath(port)); } catch (_) { /* already gone */ }
}

function readOwnPid(port: number): number | null {
  const file = pidFilePath(port);
  if (!existsSync(file)) return null;
  try {
    const pid = parseInt(readFileSync(file, 'utf-8').trim(), 10);
    if (isNaN(pid) || pid <= 0) return null;
    process.kill(pid, 0); // existence check
    return pid;
  } catch (_) {
    try { unlinkSync(file); } catch (_) {}
    return null;
  }
}

function killOwnStaleProcess(port: number): boolean {
  const pid = readOwnPid(port);
  if (pid === null) return false;

  try {
    // Double-check the process still exists before killing
    process.kill(pid, 0);

    // Verify it's actually our process (check command line contains 'dashboard' or 'node')
    // This is a heuristic to avoid killing unrelated processes with recycled PIDs
    let cmdLine = '';
    try {
      if (process.platform === 'win32') {
        // Validate pid is a safe integer before shell interpolation
        if (!Number.isInteger(pid) || pid <= 0 || pid > 4194304) {
          removePidFile(port);
          return false;
        }
        cmdLine = execSync(`powershell.exe -NoProfile -NonInteractive -Command "(Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`, { timeout: 2000, encoding: 'utf-8' });
      } else {
        cmdLine = readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' ');
      }
    } catch (_) {
      // Can't read cmdline - process might be gone or we lack permissions
      removePidFile(port);
      return false;
    }

    // Only kill if it looks like a dashboard process
    if (!cmdLine.toLowerCase().includes('dashboard') && !cmdLine.toLowerCase().includes('node')) {
      console.log(`  PID ${pid} doesn't appear to be a dashboard process, skipping kill`);
      removePidFile(port);
      return false;
    }

    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    console.log(`  Killed previous dashboard (PID ${pid}) on port ${port}`);
    removePidFile(port);
    return true;
  } catch (_) {
    removePidFile(port);
    return false;
  }
}

// ── Port check ─────────────────────────────────────────────

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer()
      .once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') resolve(true);
        else resolve(false);
      })
      .once('listening', () => {
        tester.close(() => resolve(false));
      })
      .listen(port, '127.0.0.1');
  });
}

// ── API route builder ──────────────────────────────────────

export function buildApiRouter(port: number = 3737): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('X-Codesession-Api-Version', '1');
    next();
  });

  // ── CSRF protection for mutating endpoints ──────────────
  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (!origin && !referer) return next();
    
    const allowed = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
    if (origin && allowed.some(a => origin.startsWith(a))) return next();
    if (referer && allowed.some(a => referer.startsWith(a))) return next();
    
    res.status(403).json({ error: 'CSRF' });
  });

  router.get('/stats', (_req, res) => {
    try {
      const stats = getStats();
      const active = getActiveSessions();
      res.json({ ...stats, activeSessions: active.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── License endpoints ────────────────────────────────────

  router.get('/license', (_req, res) => {
    try {
      res.json(getLicense());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/license/activate', async (req, res) => {
    try {
      const { key } = req.body;
      if (!key) return res.status(400).json({ success: false, error: 'Key is required' });
      const result = await activateLicense(key);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post('/license/deactivate', async (_req, res) => {
    try {
      await deactivateLicense();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post('/lead', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Invalid email' });
      }

      const SUPABASE_URL = 'https://igmpvdvygkgjilakgslz.supabase.co';
      const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbXB2ZHZ5Z2tnamlsYWtnc2x6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjI1ODAsImV4cCI6MjA5NTAzODU4MH0.iQMMxcRLsh1wJppUZSirsP0TKdDyzWD4aafXPJvFPFg';

      const response = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ email, source: 'dashboard' })
      });

      if (!response.ok) {
        throw new Error('Failed to capture lead');
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/sessions', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const status = (req.query.status as string) || 'all';
      const search = (req.query.search as string) || '';
      res.json(getSessionsPaginated({ limit, offset, status, search }));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/sessions/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid session ID' });
      const detail = getSessionDetail(id);
      if (!detail) return res.status(404).json({ error: 'Session not found' });
      res.json(detail);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Diff endpoints ───────────────────────────────────────

  // Session diff (all files or single file)
  router.get('/sessions/:id/diff', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const session = getSession(id);
      if (!session) {
        return res.status(404).json({ error: `Session ${id} not found` });
      }

      if (!session.gitRoot) {
        return res.status(400).json({ error: `Session ${id} has no git repository (not in a git directory)` });
      }

      if (!session.startGitHead) {
        return res.status(400).json({ error: `Session ${id} has no start git HEAD (session started before git tracking was enabled)` });
      }

      const filePath = req.query.file as string | undefined;
      const commits = getCommits(id);
      const toSha = session.status === 'active' ? null : (commits.length > 0 ? commits[commits.length - 1].hash : null);

      const diff = await getGitDiff(session.gitRoot, session.startGitHead, toSha, filePath || undefined);
      res.type('text/plain').send(diff || '(no changes)');
    } catch (e: any) {
      res.status(500).json({ error: `Failed to fetch diff: ${e.message}` });
    }
  });

  // Single commit diff
  router.get('/sessions/:id/commits/:hash/diff', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const session = getSession(id);
      if (!session) {
        return res.status(404).json({ error: `Session ${id} not found` });
      }

      if (!session.gitRoot) {
        return res.status(400).json({ error: `Session ${id} has no git repository` });
      }

      const hash = req.params.hash;
      if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) {
        return res.status(400).json({ error: 'Invalid commit hash' });
      }
      const filePath = req.query.file as string | undefined;
      const diff = await getCommitDiff(session.gitRoot, hash, filePath || undefined);
      res.type('text/plain').send(diff || '(no changes)');
    } catch (e: any) {
      res.status(500).json({ error: `Failed to fetch commit diff: ${e.message}` });
    }
  });

  // Per-file diff stats (additions/deletions) for a session
  router.get('/sessions/:id/diff-stats', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }
      const session = getSession(id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (!session.gitRoot || !session.startGitHead) {
        return res.json([]);
      }

      const commits = getCommits(id);
      const toSha = session.status === 'active' ? null : (commits.length > 0 ? commits[commits.length - 1].hash : null);

      const stats = await getGitDiffStats(session.gitRoot, session.startGitHead, toSha);
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/daily-costs', (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      res.json(getDailyCosts(days));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/model-breakdown', (_req, res) => {
    try {
      res.json(getModelBreakdown());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/top-sessions', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      res.json(getTopSessions(limit));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/provider-breakdown', (_req, res) => {
    try {
      res.json(getProviderBreakdown());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/file-hotspots', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      res.json(getFileHotspots(limit));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/activity-heatmap', (_req, res) => {
    try {
      res.json(getActivityHeatmap());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/daily-tokens', (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      res.json(getDailyTokens(days));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/cost-velocity', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      res.json(getCostVelocity(limit));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/projects', (_req, res) => {
    try {
      res.json(getProjectBreakdown());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/token-ratios', (_req, res) => {
    try {
      res.json(getTokenRatios());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/pricing', (_req, res) => {
    try {
      res.json(loadPricing());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/pro/ops', (_req, res) => {
    try {
      res.json(getProOpsSummary());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Local Models API (free) ──────────────────────────────────

  router.get('/local-models', (_req, res) => {
    try {
      const { getLocalModels } = require('./local-models');
      res.json(getLocalModels());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/local-models', (req, res) => {
    try {
      const { addLocalModel } = require('./local-models');
      const { provider, model, costPerHour, gpuName, notes } = req.body;
      if (!provider || !model || typeof costPerHour !== 'number') {
        return res.status(400).json({ error: 'provider, model, and costPerHour are required' });
      }
      const config = addLocalModel({ provider, model, costPerHour, gpuName, notes });
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/local-models/:provider/:model', (req, res) => {
    try {
      const { removeLocalModel } = require('./local-models');
      const removed = removeLocalModel(req.params.provider, req.params.model);
      res.json({ removed });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Audit API (enterprise-gated) ─────────────────────────────

  router.get('/audit', (_req, res) => {
    try {
      const license = getLicense();
      if (!license.valid || license.plan !== 'enterprise') {
        return res.status(403).json({ error: 'Audit trail requires an Enterprise license' });
      }
      const { getAuditLog } = require('../pro/src/audit');
      const limit = parseInt(_req.query.limit as string) || 20;
      const offset = parseInt(_req.query.offset as string) || 0;
      const since = _req.query.since as string || undefined;
      const eventType = _req.query.eventType as string || undefined;
      res.json(getAuditLog({ limit, offset, since, eventType }));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/audit/export', (_req, res) => {
    try {
      const license = getLicense();
      if (!license.valid || license.plan !== 'enterprise') {
        return res.status(403).json({ error: 'Audit export requires an Enterprise license' });
      }
      const { exportAuditLog } = require('../pro/src/audit');
      const format = (_req.query.format as string) || 'json';
      const data = exportAuditLog(format, { since: _req.query.since as string });
      const mime = format === 'csv' ? 'text/csv' : 'application/json';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="CostHQ-audit.${format === 'csv' ? 'csv' : 'json'}"`);
      res.send(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/audit/verify', (_req, res) => {
    try {
      const license = getLicense();
      if (!license.valid || license.plan !== 'enterprise') {
        return res.status(403).json({ error: 'Audit verification requires an Enterprise license' });
      }
      const { verifyAuditIntegrity } = require('../pro/src/audit');
      res.json(verifyAuditIntegrity());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/export', (req, res) => {
    try {
      const format = (req.query.format as string) === 'csv' ? 'csv' : 'json';
      const limit = parseInt(req.query.limit as string) || undefined;
      const data = exportSessions(format, limit);
      const mime = format === 'csv' ? 'text/csv' : 'application/json';
      const ext = format === 'csv' ? 'csv' : 'json';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="CostHQ-export.${ext}"`);
      res.send(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/version', (_req, res) => {
    try {
      const pkg = require('../../package.json');
      res.json({ version: pkg.version, apiVersion: 1 });
    } catch {
      res.json({ version: 'unknown', apiVersion: 1 });
    }
  });

  router.post('/reset', (req, res) => {
    // Require explicit confirmation header to prevent accidental data loss
    if (req.headers['x-confirm-reset'] !== 'yes') {
      return res.status(400).json({ error: 'Missing X-Confirm-Reset: yes header. This action permanently deletes all session data.' });
    }
    try {
      clearAllData();
      res.json({ ok: true, message: 'All session data cleared' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Feedback ─────────────────────────────────────────────

  router.post('/feedback', (req, res) => {
    try {
      const { type, message, email } = req.body || {};
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message is required' });
      }
      const validTypes = ['feature', 'bug', 'general', 'question'];
      const feedbackType = validTypes.includes(type) ? type : 'general';
      const result = addFeedback({
        type: feedbackType,
        message: message.trim().slice(0, 5000),
        email: typeof email === 'string' ? email.trim().slice(0, 200) : undefined,
      });
      res.json({ ok: true, id: result.id, timestamp: result.timestamp });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/feedback', (_req, res) => {
    try {
      res.json(getFeedback(100));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Console API ──────────────────────────────────────────

  router.post('/console/start', async (req, res) => {
    try {
      const { name, directory } = req.body;
      if (!name || !directory) return res.status(400).json({ error: 'Name and directory are required' });

      const gitRoot = await getGitRoot(directory);
      const scopeDir = gitRoot || directory;

      const sameDir = getActiveSessionForDir(scopeDir);
      if (sameDir) {
        return res.status(400).json({ error: `Session "${sameDir.name}" is already active for this directory.` });
      }

      const startHead = await getGitHead(scopeDir);
      const sessionId = createSession({
        name,
        startTime: new Date().toISOString(),
        workingDirectory: scopeDir,
        gitRoot: gitRoot || undefined,
        startGitHead: startHead || undefined,
        filesChanged: 0,
        commits: 0,
        aiCost: 0,
        aiTokens: 0,
        status: 'active',
      });

      initGit(sessionId, scopeDir);
      startWatcher(sessionId, scopeDir);
      startGitPolling(sessionId, 10000);

      res.json({ success: true, sessionId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/console/log-ai', (req, res) => {
    try {
      const { provider, model, tokens, promptTokens, completionTokens, cost, agent } = req.body;
      const session = getActiveSessions()[0];
      if (!session) return res.status(400).json({ error: 'No active session' });

      let finalCost = cost;
      if (finalCost === undefined || finalCost === null) {
        const totalTokens = tokens || ((promptTokens || 0) + (completionTokens || 0));
        const promptTk = promptTokens ?? totalTokens * 0.7;
        const completionTk = completionTokens ?? totalTokens * 0.3;
        const pricing = loadPricing();
        const entry = pricing[`${provider}/${model}`] || pricing[model];
        if (entry) {
          finalCost = (promptTk * entry.input + completionTk * entry.output) / 1_000_000;
        } else {
          return res.status(400).json({ error: `Unknown model "${model}". Please provide cost manually.` });
        }
      }

      addAIUsage({
        sessionId: session.id!,
        provider,
        model,
        tokens: tokens || ((promptTokens || 0) + (completionTokens || 0)),
        promptTokens: promptTokens || undefined,
        completionTokens: completionTokens || undefined,
        cost: finalCost,
        agentName: agent,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/console/end', (req, res) => {
    try {
      const session = getActiveSessions()[0];
      if (!session) return res.status(400).json({ error: 'No active session' });

      stopWatcher(session.id!);
      stopGitPolling(session.id!);
      endSession(session.id!, new Date().toISOString(), 'Ended from console');

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

// ── Main ───────────────────────────────────────────────────

export function startDashboard(options: DashboardOptions = {}): void {
  const port = options.port || 3737;
  const host = options.host || '127.0.0.1';
  const shouldOpen = options.open !== false;
  const jsonMode = options.json === true;
  const isExposed = host !== '127.0.0.1' && host !== 'localhost';

  // Generate session token for non-localhost binding
  const token = isExposed ? randomBytes(24).toString('base64url') : null;

  if (isExposed) {
    const msg = 'WARNING: Binding to ' + host + ' exposes session data (costs, repo activity, file paths) to your network. Use only on trusted networks.';
    if (jsonMode) {
      process.stderr.write(JSON.stringify({ warning: msg }) + '\n');
    } else {
      console.warn(`\n  ${msg}\n`);
    }
  }

  const app = express();

  // ── Security hardening (inline, no helmet dependency) ────

  app.disable('x-powered-by');

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isExposed) {
      // Strict CSP only when exposed
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
    }
    next();
  });

  // JSON body limit (4kb -- we only read, but defence-in-depth)
  app.use(express.json({ limit: '50kb' }));

  // CSRF protection is now handled inside buildApiRouter

  // ── Token auth for non-localhost ─────────────────────────

  if (token) {
    app.use('/api', (req: Request, res: Response, next: NextFunction) => {
      const qToken = req.query.token as string | undefined;
      const hToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (qToken === token || hToken === token) {
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized. Provide token via ?token= or Authorization: Bearer <token>' });
      }
    });
  }

  // ── Static files with cache headers ──────────────────────

  // Find the static directory whether running from dist/src/ (prod) or src/ (dev via tsx)
  const prodStaticDir = join(__dirname, '../dashboard-ui');
  const devStaticDir = join(__dirname, '../../dist/dashboard-ui');
  const staticDir = existsSync(prodStaticDir) ? prodStaticDir : devStaticDir;

  // Hashed assets (js/css with content hash in filename): immutable, 1 year
  app.use('/assets', express.static(join(staticDir, 'assets'), {
    maxAge: '365d',
    immutable: true,
  }));

  // index.html and other root files: no-cache (always fresh after upgrades)
  // index: false prevents serving raw index.html (SPA fallback serves injected version)
  app.use(express.static(staticDir, {
    maxAge: 0,
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));

  // ── API version header on all API responses ──────────────

  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Codesession-Api-Version', '1');
    next();
  });

  // ── Mount API router at /api/v1 (canonical) and /api (compat alias) ──

  const apiRouter = buildApiRouter(port);
  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  // ── SPA fallback ─────────────────────────────────────────

  // Read index.html once; inject token via <meta> tag (avoids CSP script-src issues)
  const indexPath = join(staticDir, 'index.html');
  let servedHtml: string;
  if (!existsSync(indexPath)) {
    // Dashboard UI hasn't been built — serve a helpful error instead of crashing
    servedHtml = `<!DOCTYPE html><html><head><title>CostHQ Dashboard</title></head><body style="font-family:system-ui;padding:40px;color:#ccc;background:#1a1a2e">
      <h1>Dashboard not built</h1>
      <p>Run <code style="color:#00d9ff">npm run build:dashboard</code> first, then restart <code style="color:#00d9ff">cs dashboard</code>.</p>
    </body></html>`;
    if (!jsonMode) {
      console.warn('  Warning: Dashboard UI not found. Run `npm run build:dashboard` first.');
    }
  } else {
    const rawHtml = readFileSync(indexPath, 'utf-8');
    servedHtml = token
      ? rawHtml.replace('</head>', `<meta name="cs-token" content="${token}">\n</head>`)
      : rawHtml;
  }

  // Serve index.html for all known SPA routes so client-side routing works on refresh.
  // Using explicit app.get() instead of app.use() catch-all for Express 5 compatibility.
  const sendSpa = (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Content-Type', 'text/html');
    res.send(servedHtml);
  };
  app.get('/', sendSpa);
  app.get('/sessions', sendSpa);
  app.get('/sessions/:id', sendSpa);
  app.get('/models', sendSpa);
  app.get('/insights', sendSpa);
  app.get('/alerts', sendSpa);

  // ── Port conflict handling & startup ──────────────────────

  const startServer = () => {
    const server = app.listen(port, host, () => {
      const url = `http://localhost:${port}`;

      writePidFile(port);

      const cleanup = () => { removePidFile(port); process.exit(); };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      if (jsonMode) {
        const out: Record<string, any> = { url, port, pid: process.pid, host, apiVersion: 1 };
        if (token) out.token = token;
        console.log(JSON.stringify(out));
      } else {
        console.log(`\n  CostHQ Dashboard -> ${url}`);
        if (token) {
          console.log(`  Session token: ${token}`);
          console.log(`  Authenticated URL: ${url}?token=${token}`);
        }
        console.log('  Press Ctrl+C to stop\n');
      }

      if (shouldOpen && !jsonMode) {
        const openUrl = token ? `${url}?token=${token}` : url;
        // Use spawn() with argument array to prevent command injection
        try {
          if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'start', '', openUrl], { detached: true, stdio: 'ignore' }).unref();
          } else {
            const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
            spawn(cmd, [openUrl], { detached: true, stdio: 'ignore' }).unref();
          }
        } catch (_) { /* browser open is best-effort */ }
      }
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        if (jsonMode) {
          console.log(JSON.stringify({ error: 'EADDRINUSE', message: `Port ${port} is in use and could not be freed`, port }));
        } else {
          console.error(`\n  Port ${port} is in use and could not be freed.`);
          console.error(`  Try: cs dashboard --port ${port + 1}\n`);
        }
        process.exit(1);
      }
      throw err;
    });
  };

  isPortInUse(port).then(async (inUse) => {
    if (inUse) {
      if (!jsonMode) {
        console.log(`\n  Port ${port} is already in use -- checking for stale dashboard...`);
      }
      const killed = killOwnStaleProcess(port);
      if (killed) {
        // Wait for port to be freed, then verify it's actually free before starting
        await new Promise(resolve => setTimeout(resolve, 500));
        const stillInUse = await isPortInUse(port);
        if (!stillInUse) {
          startServer();
        } else {
          // Port still in use after kill - race condition or failed kill
          if (jsonMode) {
            console.log(JSON.stringify({ error: 'EADDRINUSE', message: `Port ${port} could not be freed`, port }));
          } else {
            console.error(`  Port ${port} could not be freed.`);
            console.error(`  Try: cs dashboard --port ${port + 1}\n`);
          }
          process.exit(1);
        }
      } else {
        if (jsonMode) {
          console.log(JSON.stringify({ error: 'EADDRINUSE', message: `Port ${port} is in use by another process (not a CostHQ Dashboard)`, port }));
        } else {
          console.error(`  Port ${port} is in use by another process (not a CostHQ Dashboard).`);
          console.error(`  Try: cs dashboard --port ${port + 1}\n`);
        }
        process.exit(1);
      }
    } else {
      startServer();
    }
  });
}
