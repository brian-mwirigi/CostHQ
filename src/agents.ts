/**
 * Agent Sessions - Programmatic API for AI agents
 * 
 * Track agent runs with automatic file watching, git tracking,
 * AI cost logging, and budget enforcement.
 * 
 * @example
 * ```typescript
 * import { AgentSession } from 'costhq/agents';
 * 
 * const session = new AgentSession('Refactor auth module', {
 *   budget: 5.00,
 *   directory: './src',
 *   git: true,
 * });
 * 
 * session.start();
 * // ... agent does work ...
 * const summary = session.end();
 * ```
 */

import {
  createSession,
  endSession as dbEndSession,
  getSession,
  addAIUsage,
  getFileChanges,
  getCommits,
  getAIUsage,
} from './db';
import { initGit, startGitPolling, stopGitPolling, checkForNewCommits, cleanupGit } from './git';
import { startWatcher, stopWatcher, cleanupWatcher } from './watcher';

export interface AgentSessionConfig {
  /** Hard budget cap in dollars. Session auto-ends if exceeded. */
  budget?: number;
  /** Directory to watch for file changes. Defaults to cwd. */
  directory?: string;
  /** Enable git commit tracking. Defaults to true. */
  git?: boolean;
  /** Interval (ms) to check for new git commits. Defaults to 5000. */
  gitPollInterval?: number;
  /** Callback when budget is exceeded. Called before session ends. */
  onBudgetExceeded?: (spent: number, budget: number) => void;
  /** Callback when AI usage is logged. */
  onAIUsage?: (cost: number, totalCost: number, model: string) => void;
  /** Callback on each file change. */
  onFileChange?: (filePath: string, changeType: string) => void;
  /** Optional metadata to attach to the session. */
  metadata?: Record<string, any>;
}

export interface AgentSessionSummary {
  sessionId: number;
  name: string;
  duration: number;
  filesChanged: number;
  commits: number;
  aiCost: number;
  aiTokens: number;
  budgetRemaining: number | null;
  files: { path: string; type: string; timestamp: string }[];
  commitList: { hash: string; message: string; timestamp: string }[];
  aiUsageBreakdown: { provider: string; model: string; tokens: number; cost: number; timestamp: string }[];
  metadata?: Record<string, any>;
}

export class AgentSession {
  private sessionId: number | null = null;
  private name: string;
  private config: AgentSessionConfig;
  private totalCost = 0;
  private totalTokens = 0;
  private started = false;
  private ended = false;

  constructor(name: string, config: AgentSessionConfig = {}) {
    this.name = name;
    this.config = {
      git: true,
      gitPollInterval: 5000,
      ...config,
    };
  }

  /**
   * Start the agent session. Begins file watching and git tracking.
   * @returns The session ID
   */
  start(): number {
    if (this.started) {
      throw new Error(`Session "${this.name}" is already started.`);
    }
    if (this.ended) {
      throw new Error(`Session "${this.name}" has already ended. Create a new AgentSession.`);
    }

    const cwd = this.config.directory || process.cwd();

    this.sessionId = createSession({
      name: this.name,
      startTime: new Date().toISOString(),
      workingDirectory: cwd,
      filesChanged: 0,
      commits: 0,
      aiCost: 0,
      aiTokens: 0,
      status: 'active',
    });

    // Start file watcher
    startWatcher(this.sessionId, cwd);

    // Start git polling
    if (this.config.git) {
      initGit(this.sessionId, cwd);
      startGitPolling(this.sessionId, this.config.gitPollInterval);
    }

    this.started = true;
    return this.sessionId;
  }

  /**
   * Log AI usage for this session. Automatically checks budget.
   * Cost is optional — auto-calculated from built-in pricing if omitted (requires known model).
   * @returns The remaining budget (null if no budget set)
   * @throws BudgetExceededError if budget is exceeded
   */
  logAI(provider: string, model: string, tokens: number, cost: number, options?: { promptTokens?: number; completionTokens?: number; agentName?: string }): number | null {
    this.assertStarted();

    // Check budget BEFORE writing to database
    const newTotalCost = this.totalCost + cost;
    if (this.config.budget !== undefined && newTotalCost >= this.config.budget) {
      // Write the usage to DB since it's the last allowed call, then end the session
      addAIUsage({
        sessionId: this.sessionId!,
        provider,
        model,
        tokens,
        promptTokens: options?.promptTokens,
        completionTokens: options?.completionTokens,
        cost,
        agentName: options?.agentName,
        timestamp: new Date().toISOString(),
      });

      this.totalCost = newTotalCost;
      this.totalTokens += tokens;

      if (this.config.onBudgetExceeded) {
        this.config.onBudgetExceeded(newTotalCost, this.config.budget);
      }

      // End session before throwing so there's no orphaned active session
      this.end(`Budget reached: $${newTotalCost.toFixed(2)} / $${this.config.budget.toFixed(2)}`);
      throw new BudgetExceededError(newTotalCost, this.config.budget);
    }

    // Budget check passed - safe to write to DB
    addAIUsage({
      sessionId: this.sessionId!,
      provider,
      model,
      tokens,
      promptTokens: options?.promptTokens,
      completionTokens: options?.completionTokens,
      cost,
      agentName: options?.agentName,
      timestamp: new Date().toISOString(),
    });

    this.totalCost = newTotalCost;
    this.totalTokens += tokens;

    // Notify callback
    if (this.config.onAIUsage) {
      this.config.onAIUsage(cost, this.totalCost, model);
    }

    return this.config.budget !== undefined
      ? Math.max(0, this.config.budget - this.totalCost)
      : null;
  }

  /**
   * Check how much budget remains.
   * @returns Remaining budget in dollars, or null if no budget set
   */
  get budgetRemaining(): number | null {
    if (this.config.budget === undefined) return null;
    return Math.max(0, this.config.budget - this.totalCost);
  }

  /** Current total cost spent in this session */
  get spent(): number {
    return this.totalCost;
  }

  /** Current total tokens used in this session */
  get tokens(): number {
    return this.totalTokens;
  }

  /** Whether this session is currently active */
  get isActive(): boolean {
    return this.started && !this.ended;
  }

  /** The database session ID (null if not started) */
  get id(): number | null {
    return this.sessionId;
  }

  /**
   * End the agent session and return a full summary.
   */
  end(notes?: string): AgentSessionSummary {
    this.assertStarted();

    // Stop tracking
    stopWatcher(this.sessionId!);
    stopGitPolling(this.sessionId!);
    cleanupGit(this.sessionId!);

    const endTime = new Date().toISOString();
    dbEndSession(this.sessionId!, endTime, notes);

    this.ended = true;

    // Build summary
    const session = getSession(this.sessionId!)!;
    const files = getFileChanges(this.sessionId!);
    const commits = getCommits(this.sessionId!);
    const aiUsage = getAIUsage(this.sessionId!);

    return {
      sessionId: this.sessionId!,
      name: this.name,
      duration: session.duration || 0,
      filesChanged: session.filesChanged,
      commits: session.commits,
      aiCost: session.aiCost,
      aiTokens: session.aiTokens,
      budgetRemaining: this.config.budget !== undefined
        ? Math.max(0, this.config.budget - session.aiCost)
        : null,
      files: files.map((f) => ({
        path: f.filePath,
        type: f.changeType,
        timestamp: f.timestamp,
      })),
      commitList: commits.map((c) => ({
        hash: c.hash,
        message: c.message,
        timestamp: c.timestamp,
      })),
      aiUsageBreakdown: aiUsage.map((a) => ({
        provider: a.provider,
        model: a.model,
        tokens: a.tokens,
        cost: a.cost,
        timestamp: a.timestamp,
      })),
      metadata: this.config.metadata,
    };
  }

  /**
   * Check if an AI call would exceed the budget.
   * Useful for pre-flight checks before making expensive API calls.
   * @returns true if the call would stay within budget
   */
  canAfford(estimatedCost: number): boolean {
    if (this.config.budget === undefined) return true;
    return this.totalCost + estimatedCost <= this.config.budget;
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new Error(`Session "${this.name}" has not been started. Call .start() first.`);
    }
    if (this.ended) {
      throw new Error(`Session "${this.name}" has already ended.`);
    }
  }
}

/**
 * Thrown when an agent session exceeds its budget.
 * Catch this to handle budget enforcement gracefully.
 * 
 * @example
 * ```typescript
 * try {
 *   session.logAI('openai', 'gpt-4o', 5000, 0.10);
 * } catch (e) {
 *   if (e instanceof BudgetExceededError) {
 *     console.log(`Over budget: spent $${e.spent}, limit $${e.budget}`);
 *   }
 * }
 * ```
 */
export class BudgetExceededError extends Error {
  public spent: number;
  public budget: number;

  constructor(spent: number, budget: number) {
    super(`Budget exceeded: spent $${spent.toFixed(2)} of $${budget.toFixed(2)} limit`);
    this.name = 'BudgetExceededError';
    this.spent = spent;
    this.budget = budget;
  }
}

/**
 * Quick helper to run an agent function within a tracked session.
 * Handles start/end/error automatically.
 * 
 * @example
 * ```typescript
 * const summary = await runAgentSession('Fix all linting errors', {
 *   budget: 3.00,
 *   directory: './src',
 * }, async (session) => {
 *   // Your agent logic here
 *   const response = await openai.chat.completions.create({ ... });
 *   session.logAI('openai', 'gpt-4o', response.usage.total_tokens, 0.05);
 * });
 * ```
 */
export async function runAgentSession(
  name: string,
  config: AgentSessionConfig,
  agentFn: (session: AgentSession) => Promise<void>
): Promise<AgentSessionSummary> {
  const session = new AgentSession(name, config);
  session.start();

  try {
    await agentFn(session);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      // Session already ended by logAI, return summary from DB
      const dbSession = getSession(session.id!);
      if (!dbSession) {
        // Shouldn't happen, but guard against it
        return {
          sessionId: session.id!,
          name,
          duration: 0,
          filesChanged: 0,
          commits: 0,
          aiCost: 0,
          aiTokens: 0,
          budgetRemaining: 0,
          files: [],
          commitList: [],
          aiUsageBreakdown: [],
          metadata: config.metadata,
        };
      }
      const files = getFileChanges(session.id!);
      const commits = getCommits(session.id!);
      const aiUsage = getAIUsage(session.id!);

      return {
        sessionId: session.id!,
        name,
        duration: dbSession.duration || 0,
        filesChanged: dbSession.filesChanged,
        commits: dbSession.commits,
        aiCost: dbSession.aiCost,
        aiTokens: dbSession.aiTokens,
        budgetRemaining: 0,
        files: files.map((f) => ({ path: f.filePath, type: f.changeType, timestamp: f.timestamp })),
        commitList: commits.map((c) => ({ hash: c.hash, message: c.message, timestamp: c.timestamp })),
        aiUsageBreakdown: aiUsage.map((a) => ({ provider: a.provider, model: a.model, tokens: a.tokens, cost: a.cost, timestamp: a.timestamp })),
        metadata: config.metadata,
      };
    }
    // For non-budget errors, end session with error note and re-throw
    if (session.isActive) {
      session.end(`Error: ${(error as Error).message}`);
    }
    throw error;
  }

  if (session.isActive) {
    return session.end();
  }

  // Session was ended during agentFn (e.g. explicit end call)
  const dbSession = getSession(session.id!)!;
  const files = getFileChanges(session.id!);
  const commitsList = getCommits(session.id!);
  const aiUsage = getAIUsage(session.id!);

  return {
    sessionId: session.id!,
    name,
    duration: dbSession.duration || 0,
    filesChanged: dbSession.filesChanged,
    commits: dbSession.commits,
    aiCost: dbSession.aiCost,
    aiTokens: dbSession.aiTokens,
    budgetRemaining: config.budget !== undefined ? Math.max(0, config.budget - dbSession.aiCost) : null,
    files: files.map((f) => ({ path: f.filePath, type: f.changeType, timestamp: f.timestamp })),
    commitList: commitsList.map((c) => ({ hash: c.hash, message: c.message, timestamp: c.timestamp })),
    aiUsageBreakdown: aiUsage.map((a) => ({ provider: a.provider, model: a.model, tokens: a.tokens, cost: a.cost, timestamp: a.timestamp })),
    metadata: config.metadata,
  };
}
