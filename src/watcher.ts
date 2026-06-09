import chokidar from 'chokidar';
import { relative } from 'path';
import { addFileChange } from './db';

// Session-scoped watchers and deduplication
interface WatcherSession {
  watcher: chokidar.FSWatcher;
  changedFiles: Set<string>;
  cwd: string;
  timeouts: Set<NodeJS.Timeout>;
}

const sessions = new Map<number, WatcherSession>();

export function startWatcher(sessionId: number, cwd: string): void {
  // Don't start duplicate watcher for same session
  if (sessions.has(sessionId)) return;

  const watcher = chokidar.watch(cwd, {
    ignored: /(^|[\/\\])\..|(node_modules|dist|build|\.git)/,
    persistent: true,
    ignoreInitial: true,
  });

  const session: WatcherSession = {
    watcher,
    changedFiles: new Set<string>(),
    cwd,
    timeouts: new Set<NodeJS.Timeout>(),
  };

  sessions.set(sessionId, session);

  watcher
    .on('add', (path) => handleChange(sessionId, path, cwd, 'created'))
    .on('change', (path) => handleChange(sessionId, path, cwd, 'modified'))
    .on('unlink', (path) => handleChange(sessionId, path, cwd, 'deleted'))
    .on('error', (error) => console.error(`Watcher error for session ${sessionId}:`, error.message));
}

export function stopWatcher(sessionId?: number): void {
  if (sessionId !== undefined) {
    // Stop specific session watcher
    const session = sessions.get(sessionId);
    if (session) {
      session.watcher.close();
      session.changedFiles.clear();
      // Clear all pending timeouts to prevent leaks
      for (const timeout of session.timeouts) {
        clearTimeout(timeout);
      }
      session.timeouts.clear();
      sessions.delete(sessionId);
    }
  } else {
    // Legacy: stop all watchers (for backwards compatibility)
    for (const [id, session] of sessions.entries()) {
      session.watcher.close();
      session.changedFiles.clear();
      // Clear all pending timeouts to prevent leaks
      for (const timeout of session.timeouts) {
        clearTimeout(timeout);
      }
      session.timeouts.clear();
      sessions.delete(id);
    }
  }
}

export function cleanupWatcher(sessionId: number): void {
  stopWatcher(sessionId);
}

function handleChange(
  sessionId: number,
  path: string,
  cwd: string,
  changeType: 'created' | 'modified' | 'deleted'
): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  const relativePath = relative(cwd, path);

  // Deduplicate rapid changes to same file
  const key = `${relativePath}-${changeType}`;
  if (session.changedFiles.has(key)) return;

  session.changedFiles.add(key);
  const timeout = setTimeout(() => {
    session.changedFiles.delete(key);
    session.timeouts.delete(timeout);
  }, 3000);
  session.timeouts.add(timeout);

  addFileChange({
    sessionId,
    filePath: relativePath,
    changeType,
    timestamp: new Date().toISOString(),
  });
}
