import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllData } from '../src/db';
import { AgentSession, BudgetExceededError, runAgentSession } from '../src/agents';

// Mock watcher and git to avoid filesystem/git side effects in tests
vi.mock('../src/watcher', () => ({
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  cleanupWatcher: vi.fn(),
}));
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

beforeEach(() => { clearAllData(); });

describe('AgentSession', () => {
  it('starts and returns a session ID', () => {
    const s = new AgentSession('test-session', { git: false });
    const id = s.start();
    expect(id).toBeGreaterThan(0);
    expect(s.isActive).toBe(true);
    expect(s.id).toBe(id);
    s.end();
  });

  it('throws on double start', () => {
    const s = new AgentSession('double', { git: false });
    s.start();
    expect(() => s.start()).toThrow('already started');
    s.end();
  });

  it('throws on logAI before start', () => {
    const s = new AgentSession('no-start', { git: false });
    expect(() => s.logAI('p', 'm', 100, 0.01)).toThrow('not been started');
  });

  it('throws on operations after end', () => {
    const s = new AgentSession('ended', { git: false });
    s.start();
    s.end();
    expect(() => s.logAI('p', 'm', 100, 0.01)).toThrow('already ended');
    expect(() => s.end()).toThrow('already ended');
  });

  it('logAI tracks cost and tokens', () => {
    const s = new AgentSession('log-test', { git: false });
    s.start();
    s.logAI('openai', 'gpt-4o', 500, 0.05);
    expect(s.spent).toBeCloseTo(0.05, 4);
    expect(s.tokens).toBe(500);
    s.logAI('openai', 'gpt-4o', 300, 0.03);
    expect(s.spent).toBeCloseTo(0.08, 4);
    expect(s.tokens).toBe(800);
    s.end();
  });

  it('logAI returns remaining budget', () => {
    const s = new AgentSession('budget-track', { budget: 1.0, git: false });
    s.start();
    const remaining = s.logAI('p', 'm', 100, 0.30);
    expect(remaining).toBeCloseTo(0.70, 2);
    s.end();
  });

  it('logAI returns null when no budget set', () => {
    const s = new AgentSession('no-budget', { git: false });
    s.start();
    const remaining = s.logAI('p', 'm', 100, 0.01);
    expect(remaining).toBeNull();
    s.end();
  });

  it('throws BudgetExceededError when budget exceeded', () => {
    const s = new AgentSession('over-budget', { budget: 0.10, git: false });
    s.start();
    expect(() => s.logAI('p', 'm', 1000, 0.15)).toThrow(BudgetExceededError);
    expect(s.isActive).toBe(false);
  });

  it('throws BudgetExceededError when budget exactly met', () => {
    const s = new AgentSession('exact-budget', { budget: 0.10, git: false });
    s.start();
    expect(() => s.logAI('p', 'm', 500, 0.10)).toThrow(BudgetExceededError);
    expect(s.isActive).toBe(false);
  });

  it('calls onBudgetExceeded callback', () => {
    const cb = vi.fn();
    const s = new AgentSession('cb-test', { budget: 0.05, onBudgetExceeded: cb, git: false });
    s.start();
    try { s.logAI('p', 'm', 100, 0.10); } catch (_) {}
    expect(cb).toHaveBeenCalledWith(0.10, 0.05);
  });

  it('calls onAIUsage callback', () => {
    const cb = vi.fn();
    const s = new AgentSession('usage-cb', { onAIUsage: cb, git: false });
    s.start();
    s.logAI('p', 'm', 100, 0.01);
    expect(cb).toHaveBeenCalledWith(0.01, 0.01, 'm');
    s.end();
  });

  it('canAfford checks budget correctly', () => {
    const s = new AgentSession('afford', { budget: 1.0, git: false });
    s.start();
    expect(s.canAfford(0.50)).toBe(true);
    expect(s.canAfford(1.50)).toBe(false);
    s.end();
  });

  it('canAfford returns true when no budget', () => {
    const s = new AgentSession('no-limit', { git: false });
    s.start();
    expect(s.canAfford(99999)).toBe(true);
    s.end();
  });

  it('budgetRemaining getter works', () => {
    const s = new AgentSession('br', { budget: 2.0, git: false });
    s.start();
    expect(s.budgetRemaining).toBe(2.0);
    s.logAI('p', 'm', 100, 0.50);
    expect(s.budgetRemaining).toBeCloseTo(1.50, 2);
    s.end();
  });

  it('end returns summary with all data', () => {
    const s = new AgentSession('summary', { budget: 10, git: false, metadata: { env: 'test' } });
    s.start();
    s.logAI('openai', 'gpt-4o', 500, 0.05, { promptTokens: 300, completionTokens: 200, agentName: 'TestBot' });
    const summary = s.end('test complete');
    expect(summary.sessionId).toBeGreaterThan(0);
    expect(summary.name).toBe('summary');
    expect(summary.aiCost).toBeCloseTo(0.05, 4);
    expect(summary.aiTokens).toBe(500);
    expect(summary.budgetRemaining).toBeCloseTo(9.95, 2);
    expect(summary.aiUsageBreakdown.length).toBe(1);
    expect(summary.metadata).toEqual({ env: 'test' });
  });
});

describe('runAgentSession', () => {
  it('runs agent function and returns summary', async () => {
    const summary = await runAgentSession('run-test', { git: false }, async (session) => {
      session.logAI('p', 'm', 100, 0.01);
    });
    expect(summary.name).toBe('run-test');
    expect(summary.aiTokens).toBe(100);
  });

  it('handles BudgetExceededError gracefully', async () => {
    const summary = await runAgentSession('budget-run', { budget: 0.05, git: false }, async (session) => {
      session.logAI('p', 'm', 1000, 0.10);
    });
    expect(summary.budgetRemaining).toBe(0);
    expect(summary.aiCost).toBeCloseTo(0.10, 2);
  });

  it('re-throws non-budget errors after ending session', async () => {
    await expect(runAgentSession('error-run', { git: false }, async () => {
      throw new Error('something broke');
    })).rejects.toThrow('something broke');
  });

  it('handles session ended during agentFn', async () => {
    const summary = await runAgentSession('early-end', { git: false }, async (session) => {
      session.logAI('p', 'm', 50, 0.005);
      session.end('done early');
    });
    expect(summary.name).toBe('early-end');
  });
});
