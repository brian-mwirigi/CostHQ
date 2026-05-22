import { simpleGit, SimpleGit } from 'simple-git';
import { addCommit } from './db';

// Session-scoped git instances and commit tracking
interface GitSession {
  git: SimpleGit;
  lastCommitHash: string | null;
  interval?: NodeJS.Timeout;
}

const sessions = new Map<number, GitSession>();

export function initGit(sessionId: number, cwd: string): void {
  sessions.set(sessionId, {
    git: simpleGit(cwd),
    lastCommitHash: null,
  });
}

export async function checkForNewCommits(sessionId: number): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    const log = await session.git.log({ maxCount: 1 });
    if (log.latest && log.latest.hash !== session.lastCommitHash) {
      session.lastCommitHash = log.latest.hash;

      addCommit({
        sessionId,
        hash: log.latest.hash.substring(0, 7),
        message: log.latest.message,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    // Not a git repo or no commits yet
  }
}

export async function getGitInfo(sessionId: number): Promise<{ branch: string; hasChanges: boolean } | null> {
  const session = sessions.get(sessionId);
  if (!session) return null;

  try {
    const branch = await session.git.revparse(['--abbrev-ref', 'HEAD']);
    const status = await session.git.status();
    return {
      branch: branch.trim(),
      hasChanges: !status.isClean(),
    };
  } catch (error) {
    return null;
  }
}

export function startGitPolling(sessionId: number, intervalMs: number = 10000): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Clear existing interval if any
  if (session.interval) {
    clearInterval(session.interval);
  }

  // Start new polling interval
  session.interval = setInterval(async () => {
    await checkForNewCommits(sessionId);
  }, intervalMs);
}

export function stopGitPolling(sessionId: number): void {
  const session = sessions.get(sessionId);
  if (session?.interval) {
    clearInterval(session.interval);
    session.interval = undefined;
  }
}

export function cleanupGit(sessionId: number): void {
  stopGitPolling(sessionId);
  sessions.delete(sessionId);
}

/**
 * Get the root directory of the current git repository.
 */
export async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    const g = simpleGit(cwd);
    const root = await g.revparse(['--show-toplevel']);
    return root.trim();
  } catch (_) {
    return null;
  }
}

/**
 * Get the current HEAD SHA (full hash).
 */
export async function getGitHead(cwd: string): Promise<string | null> {
  try {
    const g = simpleGit(cwd);
    const head = await g.revparse(['HEAD']);
    return head.trim();
  } catch (_) {
    return null;
  }
}

/**
 * Get files changed between a start SHA and HEAD via `git diff --name-status`.
 * Returns an array of { filePath, changeType }.
 */
export async function getGitDiffFiles(cwd: string, fromHead: string): Promise<{ filePath: string; changeType: 'created' | 'modified' | 'deleted' }[]> {
  try {
    const g = simpleGit(cwd);
    const diff = await g.diff(['--name-status', `${fromHead}..HEAD`]);
    if (!diff.trim()) return [];
    return diff.trim().split('\n').map((line) => {
      const [status, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      let changeType: 'created' | 'modified' | 'deleted' = 'modified';
      if (status.startsWith('A')) changeType = 'created';
      else if (status.startsWith('D')) changeType = 'deleted';
      else if (status.startsWith('R')) changeType = 'modified'; // rename
      return { filePath, changeType };
    });
  } catch (_) {
    return [];
  }
}

/**
 * Get commits between a start SHA and HEAD via `git log`.
 * Returns array of { hash, message, timestamp }.
 */
export async function getGitLogCommits(cwd: string, fromHead: string): Promise<{ hash: string; message: string; timestamp: string }[]> {
  try {
    const g = simpleGit(cwd);
    const log = await g.log({ from: fromHead, to: 'HEAD' });
    return log.all.map((entry) => ({
      hash: entry.hash.substring(0, 7),
      message: entry.message,
      timestamp: entry.date || new Date().toISOString(),
    }));
  } catch (_) {
    return [];
  }
}

/**
 * Get unified diff between two SHAs (or SHA..HEAD).
 * If filePath is provided, returns diff for that file only.
 */
export async function getGitDiff(
  cwd: string,
  fromSha: string,
  toSha: string | null,
  filePath?: string,
): Promise<string> {
  try {
    const g = simpleGit(cwd);
    const range = toSha ? `${fromSha}..${toSha}` : `${fromSha}..HEAD`;
    const args = ['diff', '--unified=5', range];
    if (filePath) args.push('--', filePath);
    const result = await g.raw(args);
    return result;
  } catch (_) {
    return '';
  }
}

/**
 * Get diff for a single commit.
 */
export async function getCommitDiff(cwd: string, hash: string, filePath?: string): Promise<string> {
  try {
    const g = simpleGit(cwd);
    const args = ['diff', '--unified=5', `${hash}~1`, hash];
    if (filePath) args.push('--', filePath);
    const result = await g.raw(args);
    return result;
  } catch (_) {
    return '';
  }
}

/**
 * Get per-file diff stats (additions/deletions) between two SHAs.
 * Uses `git diff --numstat`.
 */
export async function getGitDiffStats(
  cwd: string,
  fromSha: string,
  toSha: string | null,
): Promise<{ filePath: string; additions: number; deletions: number }[]> {
  try {
    const g = simpleGit(cwd);
    const range = toSha ? `${fromSha}..${toSha}` : `${fromSha}..HEAD`;
    const result = await g.raw(['diff', '--numstat', range]);
    if (!result.trim()) return [];
    return result.trim().split('\n').map((line) => {
      const [add, del, ...pathParts] = line.split('\t');
      return {
        filePath: pathParts.join('\t'),
        additions: add === '-' ? 0 : parseInt(add) || 0,
        deletions: del === '-' ? 0 : parseInt(del) || 0,
      };
    });
  } catch (_) {
    return [];
  }
}
