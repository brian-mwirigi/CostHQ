import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { Session, FileChange, Commit, AIUsage, SessionStats, SessionNote } from './types';
import { cleanupGit } from './git';
import { cleanupWatcher } from './watcher';

// Data directory: prefer env override, then ~/.costhq, migrate from legacy ~/.codesession or ~/.devsession
const NEW_DB_DIR = process.env.COSTHQ_DATA_DIR || join(homedir(), '.costhq');

// Auto-migrate: if new dir doesn't exist (skip for custom/test dirs)
if (!process.env.COSTHQ_DATA_DIR && !existsSync(NEW_DB_DIR)) {
  const legacyDirs = [join(homedir(), '.codesession'), join(homedir(), '.devsession')];
  const legacyDir = legacyDirs.find(existsSync);
  if (legacyDir) {
    mkdirSync(NEW_DB_DIR, { recursive: true });
    const legacyDb = join(legacyDir, 'sessions.db');
    const newDb = join(NEW_DB_DIR, 'sessions.db');
    if (existsSync(legacyDb)) {
      copyFileSync(legacyDb, newDb);
      // Verify the copied DB opens correctly
      try {
        const testDb = new Database(newDb);
        testDb.pragma('integrity_check');
        testDb.close();
      } catch (_) {
        // Corrupted copy — remove and start fresh
        try { require('fs').unlinkSync(newDb); } catch (_) {}
      }
      // Also copy pricing.json if present
      const legacyPricing = join(legacyDir, 'pricing.json');
      if (existsSync(legacyPricing)) {
        copyFileSync(legacyPricing, join(NEW_DB_DIR, 'pricing.json'));
      }
      // Inform user (stderr so it doesn't break --json stdout)
      process.stderr.write(`[CostHQ] Migrated data from ${legacyDir} -> ${NEW_DB_DIR} (old files preserved -- delete manually if desired)\n`);
    }
  }
}

const DB_DIR = NEW_DB_DIR;
const DB_PATH = join(DB_DIR, 'sessions.db');

if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode + busy timeout for concurrent access safety
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Ensure clean flush of WAL on process termination
process.on('exit', () => db.close());
process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration INTEGER,
    working_directory TEXT NOT NULL,
    git_root TEXT,
    start_git_head TEXT,
    files_changed INTEGER DEFAULT 0,
    commits INTEGER DEFAULT 0,
    ai_cost REAL DEFAULT 0,
    ai_tokens INTEGER DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'active'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS file_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS commits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    hash TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    cost REAL NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`);

// Migration: add granular token columns if missing
try {
  db.exec('ALTER TABLE ai_usage ADD COLUMN prompt_tokens INTEGER');
} catch (_) { /* column already exists */ }
try {
  db.exec('ALTER TABLE ai_usage ADD COLUMN completion_tokens INTEGER');
} catch (_) { /* column already exists */ }
try {
  db.exec('ALTER TABLE ai_usage ADD COLUMN agent_name TEXT');
} catch (_) { /* column already exists */ }
try {
  db.exec('ALTER TABLE ai_usage ADD COLUMN duration_seconds REAL');
} catch (_) { /* column already exists */ }

// Migration: add git_root and start_git_head columns if missing
try {
  db.exec('ALTER TABLE sessions ADD COLUMN git_root TEXT');
} catch (_) { /* column already exists */ }
try {
  db.exec('ALTER TABLE sessions ADD COLUMN start_git_head TEXT');
} catch (_) { /* column already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS session_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`);

// Feedback table for in-app user feedback
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'general',
    message TEXT NOT NULL,
    email TEXT,
    timestamp TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS proxy_cache (
    hash TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    cost REAL NOT NULL,
    hits INTEGER DEFAULT 0,
    saved_cost REAL DEFAULT 0,
    last_hit TEXT,
    timestamp TEXT NOT NULL
  )
`);

try {
  db.exec('ALTER TABLE proxy_cache ADD COLUMN hits INTEGER DEFAULT 0');
} catch (_) { /* column already exists */ }
try {
  db.exec('ALTER TABLE proxy_cache ADD COLUMN saved_cost REAL DEFAULT 0');
} catch (_) { /* column already exists */ }
try {
  db.exec('ALTER TABLE proxy_cache ADD COLUMN last_hit TEXT');
} catch (_) { /* column already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    details TEXT NOT NULL,
    team_id TEXT,
    checksum TEXT NOT NULL
  )
`);

// Create performance indexes for dashboard queries
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sessions_status_start ON sessions(status, start_time);
  CREATE INDEX IF NOT EXISTS idx_sessions_ai_cost ON sessions(ai_cost);
  CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
  CREATE INDEX IF NOT EXISTS idx_sessions_working_dir ON sessions(working_directory);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_session_id ON ai_usage(session_id);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_session_timestamp ON ai_usage(session_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_model ON ai_usage(provider, model);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_timestamp ON ai_usage(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
  CREATE INDEX IF NOT EXISTS idx_file_changes_session_id ON file_changes(session_id);
  CREATE INDEX IF NOT EXISTS idx_file_changes_file_path ON file_changes(file_path);
  CREATE INDEX IF NOT EXISTS idx_commits_session_id ON commits(session_id);
  CREATE INDEX IF NOT EXISTS idx_proxy_cache_timestamp ON proxy_cache(timestamp);
`);

export function createSession(session: Omit<Session, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO sessions (name, start_time, working_directory, git_root, start_git_head, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(session.name, session.startTime, session.workingDirectory, session.gitRoot || null, session.startGitHead || null, 'active');
  return result.lastInsertRowid as number;
}

export function getActiveSession(): Session | null {
  const stmt = db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY id DESC LIMIT 1');
  const row = stmt.get('active') as any;
  if (!row) return null;
  return mapSession(row);
}

export function getActiveSessions(): Session[] {
  const stmt = db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY id DESC');
  const rows = stmt.all('active') as any[];
  return rows.map(mapSession);
}

export function getActiveSessionForDir(dir: string): Session | null {
  // Normalize path for case-insensitive comparison on Windows
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const normDir = norm(dir);
  const stmt = db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY id DESC');
  const rows = stmt.all('active') as any[];
  for (const row of rows) {
    if (norm(row.working_directory) === normDir || (row.git_root && norm(row.git_root) === normDir)) {
      return mapSession(row);
    }
  }
  return null;
}

export function endSession(sessionId: number, endTime: string, notes?: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  if (session.status !== 'active') return;

  let duration = Math.floor((new Date(endTime).getTime() - new Date(session.startTime).getTime()) / 1000);
  // Sanity check: cap at 1 year (unlikely but prevents overflow/corruption from clock skew)
  if (duration < 0 || duration > 31536000) {
    duration = Math.max(0, Math.min(duration, 31536000));
  }

  const stmt = db.prepare(`
    UPDATE sessions
    SET end_time = ?, duration = ?, status = ?, notes = ?
    WHERE id = ?
  `);
  stmt.run(endTime, duration, 'completed', notes || null, sessionId);

  // Clean up session-scoped tracking
  cleanupGit(sessionId);
  cleanupWatcher(sessionId);
}

export function getSession(sessionId: number): Session | null {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const row = stmt.get(sessionId) as any;
  return row ? mapSession(row) : null;
}

export function getSessions(limit = 10): Session[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?');
  const rows = stmt.all(limit) as any[];
  return rows.map(mapSession);
}

export function addFileChange(change: Omit<FileChange, 'id'>): void {
  // Use transaction for atomic insert + count update
  const transaction = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO file_changes (session_id, file_path, change_type, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(change.sessionId, change.filePath, change.changeType, change.timestamp);

    // Update session files count atomically
    const updateStmt = db.prepare(`
      UPDATE sessions
      SET files_changed = (
        SELECT COUNT(DISTINCT file_path) FROM file_changes WHERE session_id = ?
      )
      WHERE id = ?
    `);
    updateStmt.run(change.sessionId, change.sessionId);
  });

  transaction();
}

export function addCommit(commit: Omit<Commit, 'id'>): void {
  // Use transaction for atomic insert + count update
  const transaction = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO commits (session_id, hash, message, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(commit.sessionId, commit.hash, commit.message, commit.timestamp);

    // Update session commits count atomically
    const updateStmt = db.prepare(`
      UPDATE sessions
      SET commits = (
        SELECT COUNT(*) FROM commits WHERE session_id = ?
      )
      WHERE id = ?
    `);
    updateStmt.run(commit.sessionId, commit.sessionId);
  });

  transaction();
}

export function addAIUsage(usage: Omit<AIUsage, 'id'>): void {
  // Use transaction for atomic insert + sum update
  const transaction = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO ai_usage (session_id, provider, model, tokens, prompt_tokens, completion_tokens, cost, agent_name, duration_seconds, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(usage.sessionId, usage.provider, usage.model, usage.tokens, usage.promptTokens || null, usage.completionTokens || null, usage.cost, usage.agentName || null, usage.durationSeconds || null, usage.timestamp);

    // Update session AI totals atomically
    const updateStmt = db.prepare(`
      UPDATE sessions
      SET ai_cost = ROUND((SELECT SUM(cost) FROM ai_usage WHERE session_id = ?) * 10000000000) / 10000000000,
          ai_tokens = (SELECT SUM(tokens) FROM ai_usage WHERE session_id = ?)
      WHERE id = ?
    `);
    updateStmt.run(usage.sessionId, usage.sessionId, usage.sessionId);
  });

  transaction();
}

export function getFileChanges(sessionId: number): FileChange[] {
  const stmt = db.prepare('SELECT * FROM file_changes WHERE session_id = ? ORDER BY timestamp');
  const rows = stmt.all(sessionId) as any[];
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    filePath: row.file_path,
    changeType: row.change_type,
    timestamp: row.timestamp,
  }));
}

export function getCommits(sessionId: number): Commit[] {
  const stmt = db.prepare('SELECT * FROM commits WHERE session_id = ? ORDER BY timestamp');
  const rows = stmt.all(sessionId) as any[];
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    hash: row.hash,
    message: row.message,
    timestamp: row.timestamp,
  }));
}

export function getAIUsage(sessionId: number): AIUsage[] {
  const stmt = db.prepare('SELECT * FROM ai_usage WHERE session_id = ? ORDER BY timestamp');
  const rows = stmt.all(sessionId) as any[];
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    provider: row.provider,
    model: row.model,
    tokens: row.tokens,
    promptTokens: row.prompt_tokens || undefined,
    completionTokens: row.completion_tokens || undefined,
    cost: row.cost,
    durationSeconds: row.duration_seconds || undefined,
    agentName: row.agent_name || undefined,
    timestamp: row.timestamp,
  }));
}

export function exportSessions(format: 'json' | 'csv', limit?: number): string {
  const sessions = getSessions(limit || 999999);

  if (format === 'json') {
    const full = sessions.map((s) => {
      const aiUsage = getAIUsage(s.id!);
      const files = getFileChanges(s.id!);
      const commits = getCommits(s.id!);
      return { ...s, aiUsage, files, commits };
    });
    return JSON.stringify(full, null, 2);
  }

  // CSV
  const header = 'id,name,status,startTime,endTime,duration,filesChanged,commits,aiTokens,aiCost,agents,notes';
  const rows = sessions.map((s) => {
    // Wrap value in quotes, escaping any embedded double-quotes
    const q = (str: string) => `"${str.replace(/"/g, '""').replace(/\n/g, '\\n').replace(/\r/g, '')}"`;
    const aiUsage = getAIUsage(s.id!);
    const agents = [...new Set(aiUsage.map(a => a.agentName).filter(Boolean))].join('; ');
    return [
      s.id, q(s.name || ''), s.status, q(s.startTime), q(s.endTime || ''),
      s.duration || '', s.filesChanged, s.commits, s.aiTokens,
      s.aiCost, q(agents), q(s.notes || '')
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

export function getStats(days?: number): SessionStats {
  const timeFilter = days ? `AND start_time >= date('now', '-' || ? || ' days')` : '';
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(duration) as total_time,
      SUM(files_changed) as total_files,
      SUM(commits) as total_commits,
      SUM(ai_cost) as total_cost,
      AVG(duration) as avg_time
    FROM sessions WHERE status = 'completed' ${timeFilter}
  `);
  const result = days ? stmt.get(days) as any : stmt.get() as any;

  return {
    totalSessions: result.total || 0,
    totalTime: result.total_time || 0,
    totalFiles: result.total_files || 0,
    totalCommits: result.total_commits || 0,
    totalAICost: result.total_cost || 0,
    avgSessionTime: result.avg_time || 0,
  };
}

function mapSession(row: any): Session {
  return {
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
    workingDirectory: row.working_directory,
    gitRoot: row.git_root || undefined,
    startGitHead: row.start_git_head || undefined,
    filesChanged: row.files_changed,
    commits: row.commits,
    aiCost: Math.round((row.ai_cost || 0) * 1e10) / 1e10,
    aiTokens: row.ai_tokens,
    notes: row.notes,
    status: row.status,
  };
}

export function clearAllData(): void {
  // Clean up watchers/pollers for any active sessions before deleting
  const active = getActiveSessions();
  for (const s of active) {
    cleanupGit(s.id!);
    cleanupWatcher(s.id!);
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM session_notes').run();
    db.prepare('DELETE FROM feedback').run();
    db.prepare('DELETE FROM proxy_cache').run();
    db.prepare('DELETE FROM ai_usage').run();
    db.prepare('DELETE FROM file_changes').run();
    db.prepare('DELETE FROM commits').run();
    db.prepare('DELETE FROM sessions').run();
  });
  transaction();
}

export function closeDb(): void {
  db.close();
}

// ─── Config Store ──────────────────────────────────────────────

export function setConfig(key: string, value: string): void {
  const stmt = db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  stmt.run(key, value);
}

export function getConfig(key: string): string | null {
  const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
  const row = stmt.get(key) as any;
  return row ? row.value : null;
}

// ─── Proxy Cache ──────────────────────────────────────────────

export function getProxyCache(hash: string): { response: string; cost: number } | null {
  const stmt = db.prepare('SELECT response, cost FROM proxy_cache WHERE hash = ?');
  const row = stmt.get(hash) as any;
  return row ? { response: row.response, cost: row.cost } : null;
}

export function setProxyCache(hash: string, response: string, cost: number): void {
  const timestamp = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO proxy_cache (hash, response, cost, timestamp)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(hash) DO UPDATE SET
      response = excluded.response,
      cost = excluded.cost,
      timestamp = excluded.timestamp
  `);
  stmt.run(hash, response, cost, timestamp);
}

export function recordProxyCacheHit(hash: string, savedCost: number): void {
  const timestamp = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE proxy_cache
    SET hits = COALESCE(hits, 0) + 1,
        saved_cost = ROUND((COALESCE(saved_cost, 0) + ?) * 10000000000) / 10000000000,
        last_hit = ?
    WHERE hash = ?
  `);
  stmt.run(savedCost, timestamp, hash);
}

export function getProxyCacheStats(): {
  entries: number;
  hits: number;
  savedCost: number;
  storedCost: number;
  lastHit?: string;
  newestEntry?: string;
} {
  const row = db.prepare(`
    SELECT COUNT(*) as entries,
           SUM(COALESCE(hits, 0)) as hits,
           SUM(COALESCE(saved_cost, 0)) as saved_cost,
           SUM(COALESCE(cost, 0)) as stored_cost,
           MAX(last_hit) as last_hit,
           MAX(timestamp) as newest_entry
    FROM proxy_cache
  `).get() as any;
  return {
    entries: row.entries || 0,
    hits: row.hits || 0,
    savedCost: Math.round((row.saved_cost || 0) * 10000) / 10000,
    storedCost: Math.round((row.stored_cost || 0) * 10000) / 10000,
    lastHit: row.last_hit || undefined,
    newestEntry: row.newest_entry || undefined,
  };
}

export function getSpendPolicyStats(project?: string): {
  totalCost: number;
  todayCost: number;
  projectCost: number;
} {
  const total = db.prepare('SELECT SUM(ai_cost) as cost FROM sessions').get() as any;
  const today = db.prepare(`
    SELECT SUM(ai_cost) as cost
    FROM sessions
    WHERE date(start_time) = date('now', 'localtime')
  `).get() as any;

  let projectCost = 0;
  if (project) {
    const row = db.prepare(`
      SELECT SUM(ai_cost) as cost
      FROM sessions
      WHERE COALESCE(git_root, working_directory) = ?
         OR working_directory = ?
    `).get(project, project) as any;
    projectCost = row.cost || 0;
  }

  return {
    totalCost: Math.round((total.cost || 0) * 1e10) / 1e10,
    todayCost: Math.round((today.cost || 0) * 1e10) / 1e10,
    projectCost: Math.round(projectCost * 1e10) / 1e10,
  };
}

// ─── Session Notes / Annotations ──────────────────────────────

export function addNote(sessionId: number, message: string): SessionNote {
  const timestamp = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO session_notes (session_id, message, timestamp) VALUES (?, ?, ?)');
  const result = stmt.run(sessionId, message, timestamp);
  return { id: result.lastInsertRowid as number, sessionId, message, timestamp };
}

export function getNotes(sessionId: number): SessionNote[] {
  const stmt = db.prepare('SELECT * FROM session_notes WHERE session_id = ? ORDER BY timestamp');
  const rows = stmt.all(sessionId) as any[];
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    message: row.message,
    timestamp: row.timestamp,
  }));
}

// ─── Crash Recovery ───────────────────────────────────────────

export function recoverStaleSessions(maxAgeHours: number = 24): Session[] {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const stmt = db.prepare('SELECT * FROM sessions WHERE status = ? AND start_time < ?');
  const rows = stmt.all('active', cutoff) as any[];
  const stale = rows.map(mapSession);

  for (const s of stale) {
    const endStmt = db.prepare(`
      UPDATE sessions SET end_time = ?, status = ?, notes = COALESCE(notes, '') || ?
      WHERE id = ?
    `);
    endStmt.run(new Date().toISOString(), 'completed', ' [auto-recovered: stale session]', s.id);
    // Compute duration
    const dur = Math.floor((Date.now() - new Date(s.startTime).getTime()) / 1000);
    db.prepare('UPDATE sessions SET duration = ? WHERE id = ?').run(dur, s.id);
  }

  return stale;
}

// ─── Configurable Pricing ─────────────────────────────────────

const PRICING_PATH = join(DB_DIR, 'pricing.json');

const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  // ─── OpenAI ────────────────────────────
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'gpt-5.4-nano': { input: 0.20, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50 },
  'gpt-5.4': { input: 2.50, output: 15.00 },
  'gpt-5.4-pro': { input: 30.00, output: 180.00 },
  'gpt-5.5': { input: 5.00, output: 30.00 },
  'gpt-5.5-pro': { input: 30.00, output: 180.00 },
  'o3': { input: 2.00, output: 8.00 },
  'o3-pro': { input: 20.00, output: 80.00 },
  'o4-mini': { input: 0.55, output: 2.20 },
  // Legacy OpenAI
  'o1-preview': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },

  // ─── Anthropic ─────────────────────────
  'claude-haiku-4.5': { input: 1.00, output: 5.00 },
  'claude-sonnet-4.6': { input: 3.00, output: 15.00 },
  'claude-opus-4.6': { input: 5.00, output: 25.00 },
  'claude-opus-4.7': { input: 5.00, output: 25.00 },
  'claude-opus-4.8': { input: 5.00, output: 25.00 },
  // Legacy Anthropic
  'claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3.5-haiku': { input: 1.00, output: 5.00 },
  'claude-3-opus': { input: 15.00, output: 75.00 },

  // ─── Google ────────────────────────────
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-pro-200k': { input: 2.50, output: 15.00 },
  'gemini-3-flash': { input: 0.50, output: 3.00 },
  'gemini-3.1-pro': { input: 2.00, output: 12.00 },
  'gemini-3.5-flash': { input: 1.50, output: 9.00 },
  // Legacy Google
  'gemini-1.5-pro': { input: 3.50, output: 10.50 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },

  // ─── DeepSeek ──────────────────────────
  'deepseek-v3': { input: 0.27, output: 1.10 },
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },

  // ─── xAI (Grok) ────────────────────────
  'grok-3-mini': { input: 0.30, output: 0.50 },
  'grok-3': { input: 3.00, output: 15.00 },
  'grok-4.3': { input: 1.25, output: 2.50 },

  // ─── Mistral AI ────────────────────────
  'mistral-nemo': { input: 0.15, output: 0.15 },
  'devstral-small-2': { input: 0.10, output: 0.30 },
  'mistral-small-4': { input: 0.10, output: 0.30 },
  'ministral-14b': { input: 0.20, output: 0.20 },
  'mixtral-8x7b': { input: 0.70, output: 0.70 },
  'mistral-medium-3.5': { input: 1.50, output: 7.50 },
  'pixtral-large': { input: 2.00, output: 6.00 },
  'magistral-small': { input: 0.50, output: 1.50 },
  'mistral-large-3': { input: 0.50, output: 4.00 },

  // ─── Meta (Llama) ──────────────────────
  'llama-4-scout': { input: 0.08, output: 0.30 },
  'llama-4-maverick': { input: 0.15, output: 0.60 },
  'llama-3.3-70b': { input: 0.88, output: 0.88 },

  // ─── Cohere ────────────────────────────
  'command-r7b': { input: 0.0375, output: 0.15 },
  'command-a': { input: 2.50, output: 10.00 },

  // ─── Perplexity ────────────────────────
  'sonar': { input: 1.00, output: 1.00 },
  'sonar-pro': { input: 3.00, output: 15.00 },
  'sonar-reasoning-pro': { input: 2.00, output: 8.00 },

  // ─── Groq (Inference) ──────────────────
  'llama-3.3-70b-groq': { input: 0.59, output: 0.79 },
  'gpt-oss-120b-groq': { input: 0.15, output: 0.60 },

  // ─── Together AI ───────────────────────
  'lfm2-24b-a2b': { input: 0.03, output: 0.12 },
  'gemma-3n-e4b': { input: 0.06, output: 0.12 },
  'gpt-oss-120b-together': { input: 0.15, output: 0.60 },
  'minimax-m2.7': { input: 0.30, output: 1.20 },
  'deepseek-v4-pro-together': { input: 2.10, output: 4.40 },
  'kimi-k2.6': { input: 1.20, output: 4.50 },
};

export function loadPricing(): Record<string, { input: number; output: number }> {
  const merged = Object.assign(Object.create(null), DEFAULT_PRICING);
  if (existsSync(PRICING_PATH)) {
    try {
      const user = JSON.parse(readFileSync(PRICING_PATH, 'utf-8'));
      // Guard against prototype pollution — only merge safe keys with valid pricing shape
      for (const key of Object.keys(user)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const val = user[key];
        if (val && typeof val === 'object' && typeof val.input === 'number' && typeof val.output === 'number') {
          merged[key] = { input: val.input, output: val.output };
        }
      }
    } catch (_) { /* ignore bad JSON */ }
  }
  return merged;
}

export function setPricing(model: string, input: number, output: number): void {
  let user: Record<string, { input: number; output: number }> = {};
  if (existsSync(PRICING_PATH)) {
    try { user = JSON.parse(readFileSync(PRICING_PATH, 'utf-8')); } catch (_) { user = {}; }
  }
  user[model] = { input, output };
  writeFileSync(PRICING_PATH, JSON.stringify(user, null, 2));
}

export function resetPricing(): void {
  if (existsSync(PRICING_PATH)) {
    writeFileSync(PRICING_PATH, '{}');
  }
}

export function deletePricing(model: string): void {
  if (existsSync(PRICING_PATH)) {
    try {
      const user = JSON.parse(readFileSync(PRICING_PATH, 'utf-8'));
      if (model in user) {
        delete user[model];
        writeFileSync(PRICING_PATH, JSON.stringify(user, null, 2));
      }
    } catch (_) { /* ignore */ }
  }
}

export function getPricingPath(): string {
  return PRICING_PATH;
}

// ─── Dashboard Queries ────────────────────────────────────────

export function getSessionsPaginated(options: {
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
}): { sessions: Session[]; total: number } {
  const { limit = 50, offset = 0, status = 'all', search = '' } = options;

  const conditions: string[] = [];
  const params: any[] = [];

  if (status && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('name LIKE ?');
    params.push(`%${search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM sessions ${where}`);
  const countResult = countStmt.get(...params) as any;

  const dataStmt = db.prepare(`SELECT * FROM sessions ${where} ORDER BY start_time DESC LIMIT ? OFFSET ?`);
  const rows = dataStmt.all(...params, limit, offset) as any[];

  return {
    sessions: rows.map(mapSession),
    total: countResult.total,
  };
}

export function getSessionDetail(sessionId: number): {
  session: Session;
  aiUsage: AIUsage[];
  files: FileChange[];
  commits: Commit[];
  notes: SessionNote[];
} | null {
  const session = getSession(sessionId);
  if (!session) return null;

  return {
    session,
    aiUsage: getAIUsage(sessionId),
    files: getFileChanges(sessionId),
    commits: getCommits(sessionId),
    notes: getNotes(sessionId),
  };
}

export function getDailyCosts(days?: number): Array<{
  day: string;
  cost: number;
  sessions: number;
  tokens: number;
}> {
  const timeFilter = days ? `WHERE start_time >= date('now', '-' || ? || ' days')` : '';
  const stmt = db.prepare(`
    SELECT date(start_time) as day,
           SUM(ai_cost) as cost,
           COUNT(*) as sessions,
           SUM(ai_tokens) as tokens
    FROM sessions
    ${timeFilter}
    GROUP BY date(start_time)
    ORDER BY day
  `);
  const rows = days ? stmt.all(days) as any[] : stmt.all() as any[];
  return rows.map(r => ({
    day: r.day,
    cost: Math.round((r.cost || 0) * 10000) / 10000,
    sessions: r.sessions,
    tokens: r.tokens || 0,
  }));
}

export function getModelBreakdown(days?: number): Array<{
  provider: string;
  model: string;
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}> {
  const timeFilter = days ? `WHERE timestamp >= date('now', '-' || ? || ' days')` : '';
  const stmt = db.prepare(`
    SELECT provider, model,
           COUNT(*) as calls,
           SUM(tokens) as total_tokens,
           SUM(COALESCE(prompt_tokens, 0)) as prompt_tokens,
           SUM(COALESCE(completion_tokens, 0)) as completion_tokens,
           SUM(cost) as total_cost
    FROM ai_usage
    ${timeFilter}
    GROUP BY provider, model
    ORDER BY total_cost DESC
  `);
  const rows = days ? stmt.all(days) as any[] : stmt.all() as any[];
  return rows.map(r => ({
    provider: r.provider,
    model: r.model,
    calls: r.calls,
    totalTokens: r.total_tokens || 0,
    promptTokens: r.prompt_tokens || 0,
    completionTokens: r.completion_tokens || 0,
    totalCost: Math.round((r.total_cost || 0) * 100) / 100,
  }));
}

export function getTopSessions(limit: number = 10, days?: number): Session[] {
  const timeFilter = days ? `AND start_time >= date('now', '-' || ? || ' days')` : '';
  const stmt = db.prepare(`
    SELECT * FROM sessions
    WHERE ai_cost > 0 ${timeFilter}
    ORDER BY ai_cost DESC
    LIMIT ${days ? '?' : '?'}
  `);
  const params = days ? [days, limit] : [limit];
  const rows = stmt.all(...params) as any[];
  return rows.map(mapSession);
}

// ─── Additional Dashboard Queries ─────────────────────────────

/** Provider-level cost/token/call rollup */
export function getProviderBreakdown(): Array<{
  provider: string;
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  models: number;
}> {
  const stmt = db.prepare(`
    SELECT provider,
           COUNT(*) as calls,
           SUM(tokens) as total_tokens,
           SUM(COALESCE(prompt_tokens, 0)) as prompt_tokens,
           SUM(COALESCE(completion_tokens, 0)) as completion_tokens,
           SUM(cost) as total_cost,
           COUNT(DISTINCT model) as models
    FROM ai_usage
    GROUP BY provider
    ORDER BY total_cost DESC
  `);
  const rows = stmt.all() as any[];
  return rows.map(r => ({
    provider: r.provider,
    calls: r.calls,
    totalTokens: r.total_tokens || 0,
    promptTokens: r.prompt_tokens || 0,
    completionTokens: r.completion_tokens || 0,
    totalCost: Math.round((r.total_cost || 0) * 100) / 100,
    models: r.models,
  }));
}

/** Cross-session file hotspots — most frequently changed files */
export function getFileHotspots(limit: number = 50): Array<{
  filePath: string;
  changeCount: number;
  sessionCount: number;
  lastChanged: string;
  creates: number;
  modifies: number;
  deletes: number;
}> {
  const stmt = db.prepare(`
    SELECT file_path,
           COUNT(*) as change_count,
           COUNT(DISTINCT session_id) as session_count,
           MAX(timestamp) as last_changed,
           SUM(CASE WHEN change_type = 'created' THEN 1 ELSE 0 END) as creates,
           SUM(CASE WHEN change_type = 'modified' THEN 1 ELSE 0 END) as modifies,
           SUM(CASE WHEN change_type = 'deleted' THEN 1 ELSE 0 END) as deletes
    FROM file_changes
    GROUP BY file_path
    ORDER BY change_count DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as any[];
  return rows.map(r => ({
    filePath: r.file_path,
    changeCount: r.change_count,
    sessionCount: r.session_count,
    lastChanged: r.last_changed,
    creates: r.creates,
    modifies: r.modifies,
    deletes: r.deletes,
  }));
}

/** Activity heatmap: session count + cost by hour-of-day and day-of-week */
export function getActivityHeatmap(): Array<{
  dayOfWeek: number;  // 0=Sun .. 6=Sat
  hour: number;       // 0–23
  sessions: number;
  cost: number;
}> {
  const stmt = db.prepare(`
    SELECT
      CAST(strftime('%w', start_time) AS INTEGER) as day_of_week,
      CAST(strftime('%H', start_time) AS INTEGER) as hour,
      COUNT(*) as sessions,
      SUM(ai_cost) as cost
    FROM sessions
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour
  `);
  const rows = stmt.all() as any[];
  return rows.map(r => ({
    dayOfWeek: r.day_of_week,
    hour: r.hour,
    sessions: r.sessions,
    cost: Math.round((r.cost || 0) * 100) / 100,
  }));
}

/** Daily tokens trend (separate from cost) */
export function getDailyTokens(days?: number): Array<{
  day: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}> {
  const timeFilter = days ? `WHERE a.timestamp >= date('now', '-' || ? || ' days')` : '';
  const stmt = db.prepare(`
    SELECT date(a.timestamp) as day,
           SUM(COALESCE(a.prompt_tokens, 0)) as prompt_tokens,
           SUM(COALESCE(a.completion_tokens, 0)) as completion_tokens,
           SUM(a.tokens) as total_tokens
    FROM ai_usage a
    ${timeFilter}
    GROUP BY date(a.timestamp)
    ORDER BY day
  `);
  const rows = days ? stmt.all(days) as any[] : stmt.all() as any[];
  return rows.map(r => ({
    day: r.day,
    promptTokens: r.prompt_tokens || 0,
    completionTokens: r.completion_tokens || 0,
    totalTokens: r.total_tokens || 0,
  }));
}

/** Cost velocity: per-session cost/hour */
export function getCostVelocity(limit: number = 50, days?: number): Array<{
  id: number;
  name: string;
  startTime: string;
  duration: number;
  aiCost: number;
  costPerHour: number;
}> {
  const timeFilter = days ? `AND start_time >= date('now', '-' || ? || ' days')` : '';
  const stmt = db.prepare(`
    SELECT id, name, start_time, duration, ai_cost
    FROM sessions
    WHERE status = 'completed' AND duration > 0 AND ai_cost > 0 ${timeFilter}
    ORDER BY start_time DESC
    LIMIT ${days ? '?' : '?'}
  `);
  const params = days ? [days, limit] : [limit];
  const rows = stmt.all(...params) as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    startTime: r.start_time,
    duration: r.duration,
    aiCost: Math.round((r.ai_cost || 0) * 10000) / 10000,
    costPerHour: r.duration > 0 ? Math.round(((r.ai_cost || 0) / (r.duration / 3600)) * 10000) / 10000 : 0,
  }));
}

/** Per-project (working directory) rollup */
export function getProjectBreakdown(): Array<{
  project: string;
  sessions: number;
  totalCost: number;
  totalTime: number;
  totalFiles: number;
  totalCommits: number;
  totalTokens: number;
  lastActive: string;
}> {
  const stmt = db.prepare(`
    SELECT COALESCE(git_root, working_directory) as project,
           COUNT(*) as sessions,
           SUM(ai_cost) as total_cost,
           SUM(duration) as total_time,
           SUM(files_changed) as total_files,
           SUM(commits) as total_commits,
           SUM(ai_tokens) as total_tokens,
           MAX(start_time) as last_active
    FROM sessions
    GROUP BY project
    ORDER BY total_cost DESC
  `);
  const rows = stmt.all() as any[];
  return rows.map(r => ({
    project: r.project,
    sessions: r.sessions,
    totalCost: Math.round((r.total_cost || 0) * 100) / 100,
    totalTime: r.total_time || 0,
    totalFiles: r.total_files || 0,
    totalCommits: r.total_commits || 0,
    totalTokens: r.total_tokens || 0,
    lastActive: r.last_active,
  }));
}

/** Prompt:completion token ratio by model */
export function getTokenRatios(): Array<{
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  ratio: number;
  calls: number;
}> {
  const stmt = db.prepare(`
    SELECT provider, model,
           SUM(COALESCE(prompt_tokens, 0)) as prompt_tokens,
           SUM(COALESCE(completion_tokens, 0)) as completion_tokens,
           COUNT(*) as calls
    FROM ai_usage
    WHERE prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL
    GROUP BY provider, model
    ORDER BY SUM(tokens) DESC
  `);
  const rows = stmt.all() as any[];
  return rows.map(r => ({
    provider: r.provider,
    model: r.model,
    promptTokens: r.prompt_tokens || 0,
    completionTokens: r.completion_tokens || 0,
    ratio: r.completion_tokens > 0 ? Math.round((r.prompt_tokens / r.completion_tokens) * 100) / 100 : 0,
    calls: r.calls,
  }));
}

// ── Feedback ────────────────────────────────────────────────

export function addFeedback(feedback: { type: string; message: string; email?: string }): { id: number; timestamp: string } {
  const timestamp = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO feedback (type, message, email, timestamp) VALUES (?, ?, ?, ?)');
  const result = stmt.run(feedback.type, feedback.message, feedback.email || null, timestamp);
  return { id: result.lastInsertRowid as number, timestamp };
}

export function getFeedback(limit = 50): { id: number; type: string; message: string; email?: string; timestamp: string }[] {
  const stmt = db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?');
  const rows = stmt.all(limit) as any[];
  return rows.map(r => ({ id: r.id, type: r.type, message: r.message, email: r.email || undefined, timestamp: r.timestamp }));
}

// ── aitoken-cli Core Merge ──────────────────────────────────

export function calculateCost(provider: string, model: string, promptTokens: number, completionTokens: number): number {
  const pricing = loadPricing();
  
  // exact match with namespace
  if (pricing[`${provider}/${model}`]) {
    const { input, output } = pricing[`${provider}/${model}`];
    return (promptTokens / 1_000_000) * input + (completionTokens / 1_000_000) * output;
  }

  // exact match
  if (pricing[model]) {
    const { input, output } = pricing[model];
    return (promptTokens / 1_000_000) * input + (completionTokens / 1_000_000) * output;
  }
  
  // prefix match (e.g., gpt-4o-2024-05-13 -> gpt-4o)
  const matches = Object.keys(pricing)
    .filter(k => model.startsWith(k) || `${provider}/${model}`.startsWith(k))
    .sort((a, b) => b.length - a.length);
    
  if (matches.length > 0) {
    const { input, output } = pricing[matches[0]];
    return (promptTokens / 1_000_000) * input + (completionTokens / 1_000_000) * output;
  }
  
  return 0; // unknown model
}

export function ensureTrackingSession(dir: string): number {
  const active = getActiveSessionForDir(dir);
  if (active && active.id !== undefined) return active.id;
  
  // auto-create a headless tracking session if none exists
  return createSession({
    name: 'Background API Session',
    startTime: new Date().toISOString(),
    workingDirectory: dir,
    status: 'active',
    filesChanged: 0,
    commits: 0,
    aiCost: 0,
    aiTokens: 0
  });
}

// ── Audit Log DB Helpers ────────────────────────────────────

export function insertAuditEvent(event: {
  timestamp: string;
  eventType: string;
  actor: string;
  details: Record<string, any>;
  teamId?: string;
  checksum: string;
}): number {
  const stmt = db.prepare(`
    INSERT INTO audit_log (timestamp, event_type, actor, details, team_id, checksum)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    event.timestamp,
    event.eventType,
    event.actor,
    JSON.stringify(event.details),
    event.teamId || null,
    event.checksum
  );
  return result.lastInsertRowid as number;
}

export function getLastAuditEvent(): { checksum: string } | null {
  const row = db.prepare('SELECT checksum FROM audit_log ORDER BY id DESC LIMIT 1').get() as any;
  return row ? { checksum: row.checksum } : null;
}

export function getAllAuditEvents(): Array<{
  id: number;
  timestamp: string;
  eventType: string;
  actor: string;
  details: Record<string, any>;
  teamId?: string;
  checksum: string;
}> {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    eventType: r.event_type,
    actor: r.actor,
    details: JSON.parse(r.details || '{}'),
    teamId: r.team_id || undefined,
    checksum: r.checksum,
  }));
}

export function queryAuditLog(options: {
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
  eventType?: string;
  actor?: string;
}): { events: Array<any>; total: number } {
  const { limit = 20, offset = 0, since, until, eventType, actor } = options;
  const conditions: string[] = [];
  const params: any[] = [];

  if (since) { conditions.push('timestamp >= ?'); params.push(since); }
  if (until) { conditions.push('timestamp <= ?'); params.push(until); }
  if (eventType) { conditions.push('event_type = ?'); params.push(eventType); }
  if (actor) { conditions.push('actor LIKE ?'); params.push(`%${actor}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM audit_log ${where}`).get(...params) as any;
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];

  return {
    events: rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      eventType: r.event_type,
      actor: r.actor,
      details: JSON.parse(r.details || '{}'),
      teamId: r.team_id || undefined,
      checksum: r.checksum,
    })),
    total: countRow.total,
  };
}
export const _testDb = db;
