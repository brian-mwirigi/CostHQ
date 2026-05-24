#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { 
  createSession, 
  getActiveSession,
  getActiveSessions,
  getActiveSessionForDir,
  endSession, 
  getSession, 
  getSessions, 
  getStats,
  getFileChanges,
  getCommits,
  addFileChange,
  addCommit,
  addAIUsage,
  getAIUsage,
  exportSessions,
  loadPricing,
  setPricing,
  resetPricing,
  getPricingPath,
  addNote,
  getNotes,
  recoverStaleSessions,
  addFeedback,
  setConfig,
  getConfig
} from './db';
import { initGit, startGitPolling, stopGitPolling, checkForNewCommits, getGitInfo, cleanupGit, getGitRoot, getGitHead, getGitDiffFiles, getGitLogCommits } from './git';
import { startWatcher, stopWatcher, cleanupWatcher } from './watcher';
import { 
  displaySession, 
  displaySessions, 
  displayStats,
  displayFileChanges,
  displayCommits
} from './formatters';
import { formatDuration, formatCost } from './formatters';
import { getLicense, isPro, activateLicense, deactivateLicense } from '../pro/src/license';
import { requirePro } from '../pro/src/gates';

const program = new Command();
const pkg = require('../../package.json');
const VERSION: string = pkg.version;
const SCHEMA_VERSION = 1;

program
  .name('codesession')
  .description('Track AI coding sessions & agent runs — time, files, commits, costs')
  .version(VERSION);

// ─── Helpers ───────────────────────────────────────────────────

/** Emit a structured JSON error and exit 1. */
function jsonError(code: string, message: string, extra?: Record<string, any>): never {
  console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, codesessionVersion: VERSION, error: { code, message, ...extra } }));
  process.exit(1);
  return undefined as never; // unreachable, helps TS
}

/** Wrap a JSON success payload with schema metadata. */
function jsonWrap(data: Record<string, any>): Record<string, any> {
  return { schemaVersion: SCHEMA_VERSION, codesessionVersion: VERSION, ...data };
}

/** Resolve the active session for the current directory (supports parallel sessions). */
async function resolveActiveSession() {
  const cwd = process.cwd();
  const gitRoot = await getGitRoot(cwd);
  const scopeDir = gitRoot || cwd;
  // Prefer session matching this directory/git root
  return getActiveSessionForDir(scopeDir) || getActiveSession();
}

function sessionToJSON(session: any, extras?: { files?: any[]; commits?: any[]; aiUsage?: any[]; notes?: any[] }) {
  const obj: any = {
    schemaVersion: SCHEMA_VERSION,
    codesessionVersion: VERSION,
    id: session.id,
    name: session.name,
    status: session.status,
    startTime: session.startTime,
    endTime: session.endTime || null,
    duration: session.duration || null,
    durationFormatted: session.duration ? formatDuration(session.duration) : null,
    workingDirectory: session.workingDirectory,
    gitRoot: session.gitRoot || null,
    filesChanged: session.filesChanged,
    commits: session.commits,
    aiTokens: session.aiTokens,
    aiCost: session.aiCost,
    notes: session.notes || null,
  };
  if (extras?.files) obj.files = extras.files;
  if (extras?.commits) obj.commits = extras.commits;
  if (extras?.aiUsage) obj.aiUsage = extras.aiUsage;
  if (extras?.notes) obj.annotations = extras.notes;
  return obj;
}

// ─── Pricing ────────────────────────────────────────────────────

function lookupPricing(model: string, provider?: string): { entry: { input: number; output: number }; source: 'built-in' | 'custom'; key: string } | null {
  const pricing = loadPricing();
  // Try provider-namespaced key first (e.g. "anthropic/claude-sonnet-4")
  if (provider) {
    const namespacedKey = `${provider}/${model}`;
    if (pricing[namespacedKey]) {
      const isCustom = isCustomPricing(namespacedKey);
      return { entry: pricing[namespacedKey], source: isCustom ? 'custom' : 'built-in', key: namespacedKey };
    }
  }
  // Fallback to plain model name
  if (pricing[model]) {
    const isCustom = isCustomPricing(model);
    return { entry: pricing[model], source: isCustom ? 'custom' : 'built-in', key: model };
  }
  return null;
}

/** Check if a model key exists in the user's custom pricing file. */
function isCustomPricing(key: string): boolean {
  const { existsSync, readFileSync } = require('fs');
  const pPath = getPricingPath();
  if (!existsSync(pPath)) return false;
  try {
    const user = JSON.parse(readFileSync(pPath, 'utf-8'));
    return key in user;
  } catch (_) { return false; }
}

function estimateCost(model: string, promptTokens: number, completionTokens: number, provider?: string): { cost: number; pricingInfo: { source: 'built-in' | 'custom' | 'manual'; modelKnown: boolean; inputPer1M: number; outputPer1M: number } } | null {
  const lookup = lookupPricing(model, provider);
  if (!lookup) return null;
  const cost = (promptTokens * lookup.entry.input + completionTokens * lookup.entry.output) / 1_000_000;
  return {
    cost,
    pricingInfo: {
      source: lookup.source,
      modelKnown: true,
      inputPer1M: lookup.entry.input,
      outputPer1M: lookup.entry.output,
    },
  };
}

// ─── Start ─────────────────────────────────────────────────────

program
  .command('start')
  .description('Start a new coding session')
  .argument('<name>', 'Session name')
  .option('--json', 'Output JSON (for agents)')
  .option('--resume', 'Resume existing active session for this directory instead of failing')
  .option('--close-stale', 'Auto-close any existing active sessions before starting')
  .action(async (name: string, options: any) => {
    const cwd = process.cwd();

    // Resolve to git root when inside a repo (avoids subdirectory fragmentation)
    const gitRoot = await getGitRoot(cwd);
    const scopeDir = gitRoot || cwd;

    // Check for existing active sessions
    const allActive = getActiveSessions();

    if (allActive.length > 0) {
      // --resume: reuse the active session for this directory/git root
      if (options.resume) {
        const forDir = getActiveSessionForDir(scopeDir);
        if (forDir) {
          // Initialize git for the resumed session to get git info
          initGit(forDir.id!, scopeDir);
          if (options.json) {
            const gitInfo = await getGitInfo(forDir.id!);
            console.log(JSON.stringify(jsonWrap({ id: forDir.id, name: forDir.name, directory: scopeDir, branch: gitInfo?.branch || null, resumed: true })));
            process.exit(0);
          } else {
            console.log(chalk.green(`\nResumed session: ${forDir.name} (id: ${forDir.id})`));
            console.log(chalk.gray(`  Started: ${forDir.startTime}\n`));
          }
          return;
        }
        // No active session for this dir — fall through and create new one
      }

      // --close-stale: end all existing active sessions
      if (options.closeStale) {
        for (const s of allActive) {
          endSession(s.id!, new Date().toISOString(), `Auto-closed by new session "${name}"`);
        }
        if (!options.json) {
          console.log(chalk.gray(`  Closed ${allActive.length} stale session(s)`));
        }
      } else if (!options.resume) {
        // Only block if there's already an active session for THIS directory
        // Different directories/git roots can run parallel sessions
        const sameDir = getActiveSessionForDir(scopeDir);
        if (sameDir) {
          if (options.json) {
            jsonError('session_active', `Session "${sameDir.name}" is already active for this directory`, {
              activeSession: sameDir.name,
              id: sameDir.id,
              hint: 'Use --resume to reattach or --close-stale to auto-close',
            });
          } else {
            console.log(chalk.yellow(`\nSession "${sameDir.name}" is already active for this directory (id: ${sameDir.id}).`));
            console.log(chalk.gray('  Options:'));
            console.log(chalk.gray('    cs end              — end it manually'));
            console.log(chalk.gray('    cs start --resume   — reuse session for this directory'));
            console.log(chalk.gray('    cs start --close-stale — auto-close stale sessions\n'));
          }
          return;
        }
        // Different directory — allow parallel session
      }
    }

    // Capture git HEAD at session start for later diff-based file/commit scan
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

    // Initialize git tracking
    initGit(sessionId, scopeDir);

    // Start file watcher (only for long-running mode, not --json agent calls)
    if (!options.json) {
      startWatcher(sessionId, scopeDir);

      // Start git commit polling (checks every 10 seconds)
      startGitPolling(sessionId, 10000);
    }

    if (options.json) {
      const gitInfo = await getGitInfo(sessionId);
      console.log(JSON.stringify(jsonWrap({ id: sessionId, name, directory: scopeDir, gitRoot: gitRoot || null, branch: gitInfo?.branch || null })));
      process.exit(0);
    } else {
      const gitInfo = await getGitInfo(sessionId);
      console.log(chalk.green(`\nSession started: ${name}`));
      if (gitInfo) {
        console.log(chalk.gray(`  Branch: ${gitInfo.branch}`));
      }
      console.log(chalk.gray(`  Directory: ${scopeDir}`));
      if (gitRoot && gitRoot !== cwd) {
        console.log(chalk.gray(`  Git root: ${gitRoot} (scoped from ${cwd})`));
      }
      console.log(chalk.gray('\n  Tracking: files, commits, AI usage'));
      console.log(chalk.gray('  End with: cs end\n'));
    }
  });

// ─── End ───────────────────────────────────────────────────────

program
  .command('end')
  .description('End the active session')
  .option('-n, --notes <notes>', 'Session notes')
  .option('-s, --session <id>', 'End a specific session by ID', parseInt)
  .option('--json', 'Output JSON (for agents)')
  .action(async (options) => {
    let session;
    if (options.session) {
      session = getSession(options.session);
      if (!session || session.status !== 'active') {
        if (options.json) {
          jsonError('session_not_found', `No active session with id ${options.session}`, { id: options.session });
        } else {
          console.log(chalk.yellow(`\nNo active session with id ${options.session}.\n`));
        }
        return;
      }
    } else {
      session = await resolveActiveSession();
    }

    if (!session) {
      if (options.json) {
        jsonError('no_active_session', 'No active session to end');
      } else {
        console.log(chalk.yellow('\nNo active session.\n'));
      }
      return;
    }

    // Stop tracking
    stopWatcher(session.id!);
    stopGitPolling(session.id!);

    // Git-based scan: if we stored a start HEAD, diff against current HEAD for accurate file/commit counts
    if (session.startGitHead) {
      const dir = session.gitRoot || session.workingDirectory;
      const diffFiles = await getGitDiffFiles(dir, session.startGitHead);
      const diffCommits = await getGitLogCommits(dir, session.startGitHead);

      // Record git-discovered file changes that weren't already tracked by watcher
      for (const f of diffFiles) {
        addFileChange({
          sessionId: session.id!,
          filePath: f.filePath,
          changeType: f.changeType,
          timestamp: new Date().toISOString(),
        });
      }
      // Record git-discovered commits not already tracked by poller
      const existing = getCommits(session.id!);
      const existingHashes = new Set(existing.map((c) => c.hash));
      for (const c of diffCommits) {
        if (!existingHashes.has(c.hash)) {
          addCommit({
            sessionId: session.id!,
            hash: c.hash,
            message: c.message,
            timestamp: c.timestamp,
          });
        }
      }
    }

    endSession(session.id!, new Date().toISOString(), options.notes);

    const updated = getSession(session.id!);
    if (updated) {
      if (options.json) {
        const files = getFileChanges(updated.id!);
        const commits = getCommits(updated.id!);
        const aiUsage = getAIUsage(updated.id!);
        const notes = getNotes(updated.id!);
        console.log(JSON.stringify(sessionToJSON(updated, { files, commits, aiUsage, notes })));
      } else {
        console.log(chalk.green('\nSession ended\n'));
        displaySession(updated);
      }
      
      // Fire webhook alert
      await fireWebhook(updated);
    }
  });

// ─── Webhook Helper ────────────────────────────────────────────

async function fireWebhook(session: any) {
  const url = getConfig('webhook_url');
  if (!url) return;
  try {
    const payload = {
      content: `Session **${session.name}** ended.`,
      embeds: [{
        title: 'Session Summary',
        color: 0x3b82f6,
        fields: [
          { name: 'Duration', value: formatDuration(session.duration), inline: true },
          { name: 'Cost', value: '$' + (session.aiCost || 0).toFixed(4), inline: true },
          { name: 'Files Changed', value: String(session.filesChanged || 0), inline: true },
          { name: 'Commits', value: String(session.commits || 0), inline: true },
        ]
      }]
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // Silently fail webhook errors
  }
}

// ─── Show ──────────────────────────────────────────────────────

program
  .command('show')
  .description('Show session details')
  .argument('[id]', 'Session ID (defaults to last session)')
  .option('--files', 'Show file changes')
  .option('--commits', 'Show commits')
  .option('--json', 'Output JSON (for agents)')
  .action((id: string | undefined, options) => {
    let session;
    
    if (id) {
      session = getSession(parseInt(id));
    } else {
      const sessions = getSessions(1);
      session = sessions[0];
    }

    if (!session) {
      if (options.json) {
        jsonError('session_not_found', id ? `Session ${id} not found` : 'No sessions found');
      } else {
        console.log(chalk.yellow('\nSession not found.\n'));
      }
      return;
    }

    if (options.json) {
      const extras: any = {};
      if (options.files) extras.files = getFileChanges(session.id!);
      if (options.commits) extras.commits = getCommits(session.id!);
      extras.aiUsage = getAIUsage(session.id!);
      extras.notes = getNotes(session.id!);
      console.log(JSON.stringify(sessionToJSON(session, extras)));
    } else {
      displaySession(session);
      if (options.files) {
        const files = getFileChanges(session.id!);
        displayFileChanges(files);
      }
      if (options.commits) {
        const commits = getCommits(session.id!);
        displayCommits(commits);
      }
    }
  });

// ─── List ──────────────────────────────────────────────────────

program
  .command('list')
  .alias('ls')
  .description('List recent sessions')
  .option('-l, --limit <number>', 'Number of sessions to show', parseInt, 10)
  .option('--json', 'Output JSON (for agents)')
  .action((options) => {
    const sessions = getSessions(options.limit);
    if (options.json) {
      console.log(JSON.stringify(sessions.map((s) => sessionToJSON(s))));
    } else {
      displaySessions(sessions);
    }
  });

// ─── Stats ─────────────────────────────────────────────────────

program
  .command('stats')
  .description('Show overall statistics')
  .option('--json', 'Output JSON (for agents)')
  .action((options) => {
    const stats = getStats();
    if (options.json) {
      console.log(JSON.stringify(jsonWrap({
        totalSessions: stats.totalSessions,
        totalTime: stats.totalTime,
        totalTimeFormatted: formatDuration(stats.totalTime),
        totalFiles: stats.totalFiles,
        totalCommits: stats.totalCommits,
        totalAICost: stats.totalAICost,
        avgSessionTime: stats.avgSessionTime,
        avgSessionFormatted: formatDuration(stats.avgSessionTime),
      })));
    } else {
      displayStats(stats);
      console.log(chalk.dim('\n  Star on GitHub: https://github.com/brian-mwirigi/codesession-cli'));
    }
  });

// ─── Log AI ────────────────────────────────────────────────────

program
  .command('log-ai')
  .description('Log AI usage for active session')
  .requiredOption('-p, --provider <provider>', 'AI provider (anthropic, openai, google, etc.)')
  .requiredOption('-m, --model <model>', 'Model name')
  .option('-t, --tokens <tokens>', 'Total tokens', parseInt)
  .option('-c, --cost <cost>', 'Cost in dollars (auto-calculated if omitted)', parseFloat)
  .option('--prompt-tokens <n>', 'Prompt/input tokens', parseInt)
  .option('--completion-tokens <n>', 'Completion/output tokens', parseInt)
  .option('--agent <name>', 'Agent name (optional)')
  .option('-s, --session <id>', 'Target a specific session by ID', parseInt)
  .option('--json', 'Output JSON (for agents)')
  .action(async (options) => {
    let session;
    if (options.session) {
      session = getSession(options.session);
      if (!session || session.status !== 'active') {
        if (options.json) {
          jsonError('session_not_found', `No active session with id ${options.session}`, { id: options.session });
        } else {
          console.log(chalk.yellow(`\nNo active session with id ${options.session}.\n`));
        }
        return;
      }
    } else {
      session = await resolveActiveSession();
    }
    if (!session) {
      if (options.json) {
        jsonError('no_active_session', 'No active session. Start one with: cs start <name>');
      } else {
        console.log(chalk.yellow('\nNo active session. Start one with: cs start <name>\n'));
      }
      return;
    }

    const promptTk = options.promptTokens || 0;
    const completionTk = options.completionTokens || 0;
    const totalTokens = options.tokens || (promptTk + completionTk);

    if (totalTokens === 0) {
      const msg = 'Must provide --tokens or --prompt-tokens/--completion-tokens';
      if (options.json) {
        jsonError('missing_tokens', msg);
      } else {
        console.log(chalk.red(`\n${msg}\n`));
      }
      return;
    }

    let cost = options.cost;
    let pricingInfo: { source: 'built-in' | 'custom' | 'manual'; modelKnown: boolean; inputPer1M: number; outputPer1M: number } | undefined;

    if (cost === undefined || cost === null) {
      // Auto-calculate from pricing table (try provider/model -> model)
      const auto = estimateCost(options.model, promptTk ?? totalTokens * 0.7, completionTk ?? totalTokens * 0.3, options.provider);
      if (auto !== null) {
        cost = Math.round(auto.cost * 1e10) / 1e10;
        pricingInfo = auto.pricingInfo;
      } else {
        const msg = `Unknown model "${options.model}" — provide -c <cost> or use --prompt-tokens/--completion-tokens with a known model`;
        if (options.json) {
          jsonError('unknown_model', msg, { model: options.model, provider: options.provider });
        } else {
          console.log(chalk.red(`\n${msg}\n`));
        }
        return;
      }
    } else {
      // Manual cost provided — check if model is known anyway for info
      const lookup = lookupPricing(options.model, options.provider);
      pricingInfo = {
        source: 'manual',
        modelKnown: lookup !== null,
        inputPer1M: lookup?.entry.input || 0,
        outputPer1M: lookup?.entry.output || 0,
      };
    }

    addAIUsage({
      sessionId: session.id!,
      provider: options.provider,
      model: options.model,
      tokens: totalTokens,
      promptTokens: promptTk || undefined,
      completionTokens: completionTk || undefined,
      cost,
      agentName: options.agent || process.env.CODESESSION_AGENT_NAME || undefined,
      timestamp: new Date().toISOString(),
    });

    // Re-read the updated session
    const updated = getSession(session.id!);
    const resolvedAgent = options.agent || process.env.CODESESSION_AGENT_NAME || undefined;
    if (options.json) {
      console.log(JSON.stringify(jsonWrap({
        logged: { provider: options.provider, model: options.model, tokens: totalTokens, promptTokens: promptTk || undefined, completionTokens: completionTk || undefined, cost, agentName: resolvedAgent },
        pricing: pricingInfo,
        session: { id: session.id, aiCost: updated?.aiCost || 0, aiTokens: updated?.aiTokens || 0 },
      })));
    } else {
      const agentStr = resolvedAgent ? ` (${resolvedAgent})` : '';
      console.log(chalk.green(`\nLogged: ${totalTokens.toLocaleString()} tokens, ${formatCost(cost)}${agentStr}`));
      console.log(chalk.gray(`  Session total: ${(updated?.aiTokens || 0).toLocaleString()} tokens, ${formatCost(updated?.aiCost || 0)}\n`));
    }
  });

// ─── Status ────────────────────────────────────────────────────

program
  .command('status')
  .description('Show active session status')
  .option('-s, --session <id>', 'Show a specific session by ID', parseInt)
  .option('--json', 'Output JSON (for agents)')
  .action(async (options) => {
    let session;
    if (options.session) {
      session = getSession(options.session);
    } else {
      session = await resolveActiveSession();
    }
    if (!session) {
      if (options.json) {
        jsonError('no_active_session', 'No active session');
      } else {
        console.log(chalk.yellow('\nNo active session.\n'));
      }
      return;
    }

    if (options.json) {
      // Calculate live duration
      const now = new Date();
      const start = new Date(session.startTime);
      const liveDuration = Math.floor((now.getTime() - start.getTime()) / 1000);
      const aiUsage = getAIUsage(session.id!);
      const notes = getNotes(session.id!);
      console.log(JSON.stringify({
        ...sessionToJSON(session, { notes }),
        liveDuration,
        liveDurationFormatted: formatDuration(liveDuration),
        aiUsage,
      }));
    } else {
      displaySession(session);
    }
  });

// ─── Export ─────────────────────────────────────────────────

program
  .command('export')
  .description('Export sessions as JSON, CSV, or a PDF receipt')
  .argument('[id]', 'Session ID (required for PDF export)')
  .option('-f, --format <format>', 'Output format: json, csv, or pdf', 'json')
  .option('-l, --limit <n>', 'Number of sessions to export (JSON/CSV)', parseInt)
  .action((id: string | undefined, options) => {
    if (options.format === 'pdf') {
      if (!id) {
        console.log(chalk.red('You must specify a session ID to export as PDF (e.g., cs export 123 --format pdf)'));
        return;
      }
      const { exportSessionToPDF } = require('./pdf-export');
      exportSessionToPDF(parseInt(id, 10));
    } else {
      const format = options.format === 'csv' ? 'csv' : 'json';
      const output = exportSessions(format, options.limit);
      console.log(output);
      
      const license = getLicense();
      if (license.valid && license.plan !== 'free') {
        console.log(chalk.gray(`Plan: ${license.plan.toUpperCase()} (${license.email})`));
      } else {
        console.log(chalk.gray(`Plan: Free | Upgrade to Pro: https://codesession.dev/pro`));
      }
    }
  });

// ─── Pricing ────────────────────────────────────────────────

const pricingCmd = program
  .command('pricing')
  .description('Manage the model pricing table used for cost auto-calculation');

pricingCmd
  .command('list')
  .description('Show all known model prices')
  .option('--json', 'Output JSON')
  .action((options) => {
    const pricing = loadPricing();
    if (options.json) {
      console.log(JSON.stringify(jsonWrap({ models: pricing })));
    } else {
      console.log(chalk.bold('\nModel Pricing (per 1M tokens)\n'));
      const sorted = Object.entries(pricing).sort(([a], [b]) => a.localeCompare(b));
      for (const [model, p] of sorted) {
        console.log(`  ${chalk.cyan(model.padEnd(24))} input: $${p.input.toFixed(2).padStart(6)}   output: $${p.output.toFixed(2).padStart(6)}`);
      }
      console.log(chalk.gray(`\n  Config: ${getPricingPath()}\n`));
    }
  });

pricingCmd
  .command('set <model> <input> <output>')
  .description('Set pricing for a model (per 1M tokens)')
  .option('--provider <provider>', 'Provider name (stored as provider/model key)')
  .action((model: string, input: string, output: string, opts: any) => {
    const inp = parseFloat(input);
    const out = parseFloat(output);
    if (isNaN(inp) || isNaN(out)) {
      console.log(chalk.red('\nInput and output must be numbers (dollars per 1M tokens)\n'));
      return;
    }
    const key = opts.provider ? `${opts.provider}/${model}` : model;
    setPricing(key, inp, out);
    console.log(chalk.green(`\n${key}: input=$${inp}/1M, output=$${out}/1M`));
    console.log(chalk.gray(`  Saved to ${getPricingPath()}\n`));
  });

pricingCmd
  .command('reset')
  .description('Remove all custom pricing overrides (revert to defaults)')
  .action(() => {
    resetPricing();
    console.log(chalk.green('\nPricing reset to defaults\n'));
  });

// ─── Note ─────────────────────────────────────────────────────

program
  .command('note')
  .description('Add a timestamped annotation to the active session')
  .argument('<message>', 'Note message')
  .option('-s, --session <id>', 'Target a specific session by ID', parseInt)
  .option('--json', 'Output JSON (for agents)')
  .action(async (message: string, options) => {
    let session;
    if (options.session) {
      session = getSession(options.session);
      if (!session || session.status !== 'active') {
        if (options.json) {
          jsonError('session_not_found', `No active session with id ${options.session}`, { id: options.session });
        } else {
          console.log(chalk.yellow(`\nNo active session with id ${options.session}.\n`));
        }
        return;
      }
    } else {
      session = await resolveActiveSession();
    }
    if (!session) {
      if (options.json) {
        jsonError('no_active_session', 'No active session');
      } else {
        console.log(chalk.yellow('\nNo active session.\n'));
      }
      return;
    }

    const note = addNote(session.id!, message);
    if (options.json) {
      console.log(JSON.stringify(jsonWrap(note)));
    } else {
      console.log(chalk.green(`\nNote added to session ${session.id}: "${message}"\n`));
    }
  });

// ─── Recover ──────────────────────────────────────────────────

program
  .command('recover')
  .description('Auto-end stale active sessions older than N hours')
  .option('--max-age <hours>', 'Max age in hours before a session is considered stale', parseFloat, 24)
  .option('--json', 'Output JSON (for agents)')
  .action((options) => {
    const recovered = recoverStaleSessions(options.maxAge);
    if (options.json) {
      console.log(JSON.stringify(jsonWrap({ recovered: recovered.length, sessions: recovered.map((s) => ({ id: s.id, name: s.name, startTime: s.startTime })) })));
    } else {
      if (recovered.length === 0) {
        console.log(chalk.gray(`\nNo stale sessions found (older than ${options.maxAge}h).\n`));
      } else {
        console.log(chalk.green(`\nRecovered ${recovered.length} stale session(s):`));
        for (const s of recovered) {
          console.log(chalk.gray(`  #${s.id} "${s.name}" (started ${s.startTime})`));
        }
        console.log();
      }
    }
  });

// ─── Feedback ───────────────────────────────────────────────────

program
  .command('feedback <message>')
  .description('Submit feedback or feature requests')
  .option('-t, --type <type>', 'Feedback type: feature, bug, general, question', 'general')
  .option('--json', 'JSON output')
  .action((message: string, options: any) => {
    const result = addFeedback({ type: options.type, message });
    if (options.json) {
      console.log(JSON.stringify(jsonWrap({ ok: true, id: result.id, type: options.type, message, timestamp: result.timestamp })));
    } else {
      console.log(chalk.green(`\nFeedback submitted! (id: ${result.id})`));
      console.log(chalk.gray(`  Type: ${options.type}`));
      console.log(chalk.gray(`  Message: ${message}\n`));
    }
  });

program
  .command('dashboard')
  .description('Open the web dashboard')
  .option('-p, --port <port>', 'Port to run on', '3737')
  .option('--host <host>', 'Host to bind to (default: 127.0.0.1)')
  .option('--no-open', 'Do not auto-open browser')
  .option('--json', 'Output JSON (machine-readable startup info: url, port, pid)')
  .action(async (options) => {
    const { startDashboard } = await import('./dashboard-server');
    startDashboard({ port: parseInt(options.port), open: options.open, host: options.host, json: options.json });
  });

// ─── Auto-Log (Claude Code Hook) ─────────────────────────────

program
  .command('auto-log')
  .description('Auto-log AI usage from a Claude Code hook (reads transcript from stdin)')
  .option('--provider <provider>', 'AI provider', 'anthropic')
  .option('--model <model>', 'Model name', 'claude-sonnet-4')
  .option('--agent <name>', 'Agent name', 'Claude Code')
  .action(async (options) => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tty = require('tty');

    if (!requirePro('Auto-log (Claude Code Integration)')) {
      process.exit(0);
    }

    // Bail if stdin is a TTY (user ran `cs auto-log` manually without piping)
    try {
      if (tty.isatty(0)) {
        console.error('auto-log expects piped JSON from a Claude Code hook. See: cs auto-log --help');
        process.exit(1);
      }
    } catch {
      // isatty can throw in some environments — proceed to read stdin anyway
    }

    // Read hook input from stdin
    let raw = '';
    try {
      raw = fs.readFileSync(process.stdin.fd, 'utf8');
    } catch {
      process.exit(0);
    }

    if (!raw.trim()) process.exit(0);

    let hookInput: any;
    try {
      hookInput = JSON.parse(raw);
    } catch {
      process.exit(0);
    }

    const transcriptPath = hookInput.transcript_path;
    const sessionId = hookInput.session_id;

    if (!transcriptPath || !sessionId) process.exit(0);
    if (!fs.existsSync(transcriptPath)) process.exit(0);

    // Must have an active codesession — if not, exit WITHOUT saving position
    // so tokens aren't lost (they'll be picked up on the next call after cs start)
    const session = await resolveActiveSession();
    if (!session) process.exit(0);

    // Track position so we don't double-count across multiple Stop events
    const posDir = path.join(os.tmpdir(), 'codesession-autolog');
    try { fs.mkdirSync(posDir, { recursive: true }); } catch {}
    const posFile = path.join(posDir, `${sessionId}.pos`);
    let lastPos = 0;
    if (fs.existsSync(posFile)) {
      const stored = parseInt(fs.readFileSync(posFile, 'utf8'), 10);
      if (!isNaN(stored) && stored >= 0) lastPos = stored;
    }

    let transcript = fs.readFileSync(transcriptPath, 'utf8');
    // Strip BOM if present
    if (transcript.charCodeAt(0) === 0xFEFF) transcript = transcript.slice(1);
    const lines = transcript.split('\n').filter((l: string) => l.trim());

    // If transcript was truncated/reset and is now shorter than our position, reset
    if (lastPos > lines.length) lastPos = 0;

    if (lines.length <= lastPos) process.exit(0);

    const newLines = lines.slice(lastPos);
    let promptChars = 0;
    let completionChars = 0;

    for (const line of newLines) {
      try {
        const msg = JSON.parse(line);
        const content = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content || msg.message || '');

        if (msg.role === 'assistant') {
          completionChars += content.length;
        } else {
          promptChars += content.length;
        }
      } catch {
        // Skip unparseable lines
      }
    }

    // Estimate tokens (roughly 1 token per 4 characters)
    const promptTokens = Math.ceil(promptChars / 4);
    const completionTokens = Math.ceil(completionChars / 4);
    const totalTokens = promptTokens + completionTokens;

    // Skip if negligible (fewer than 10 estimated tokens)
    if (totalTokens < 10) {
      // Still save position — these lines were trivial (e.g., empty system messages)
      fs.writeFileSync(posFile, String(lines.length));
      process.exit(0);
    }

    // Calculate cost
    const auto = estimateCost(options.model, promptTokens, completionTokens, options.provider);
    const cost = auto ? Math.round(auto.cost * 1e10) / 1e10 : 0;

    addAIUsage({
      sessionId: session.id!,
      provider: options.provider,
      model: options.model,
      tokens: totalTokens,
      promptTokens: promptTokens || undefined,
      completionTokens: completionTokens || undefined,
      cost,
      agentName: options.agent || process.env.CODESESSION_AGENT_NAME || 'Claude Code',
      timestamp: new Date().toISOString(),
    });

    // Only save position AFTER successful log — prevents token loss
    fs.writeFileSync(posFile, String(lines.length));

    // Output JSON for the hook
    const updated = getSession(session.id!);
    console.log(JSON.stringify(jsonWrap({
      autoLogged: true,
      tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
      cost,
      session: { id: session.id, aiCost: updated?.aiCost || 0, aiTokens: updated?.aiTokens || 0 },
    })));
  });

// ─── License ───────────────────────────────────────────────────

program
  .command('activate <key>')
  .description('Activate a Pro or Enterprise license key')
  .option('--json', 'JSON output')
  .action((key: string, options: any) => {
    const result = activateLicense(key);
    if (options.json) {
      console.log(JSON.stringify(jsonWrap(result)));
    } else if (result.success) {
      console.log(chalk.green(`\nLicense activated successfully!`));
      console.log(chalk.gray(`  Plan:  ${result.license?.plan.toUpperCase()}`));
      console.log(chalk.gray(`  Email: ${result.license?.email}`));
      if (result.license?.plan === 'enterprise') {
        console.log(chalk.gray(`  Seats: ${result.license?.seats}`));
      }
      console.log();
    } else {
      console.log(chalk.red(`\nActivation failed: ${result.error}\n`));
    }
  });

program
  .command('deactivate')
  .description('Remove the current license key')
  .option('--json', 'JSON output')
  .action((options: any) => {
    deactivateLicense();
    if (options.json) {
      console.log(JSON.stringify(jsonWrap({ success: true })));
    } else {
      console.log(chalk.green(`\nLicense deactivated. You are now on the Free plan.\n`));
    }
  });

program
  .command('license')
  .description('Show current license status')
  .option('--json', 'JSON output')
  .action((options: any) => {
    const info = getLicense();
    if (options.json) {
      console.log(JSON.stringify(jsonWrap(info)));
    } else {
      console.log(chalk.green(`\nLicense Status:`));
      console.log(chalk.gray(`  Plan:   ${info.plan.toUpperCase()}`));
      if (info.valid) {
        console.log(chalk.gray(`  Email:  ${info.email}`));
        if (info.plan === 'enterprise') {
          console.log(chalk.gray(`  Seats:  ${info.seats}`));
        }
      } else if (info.trial.active) {
        console.log(chalk.yellow(`  Trial:  ${info.trial.daysRemaining} days remaining`));
      }
    }
  });

// ─── Proxy ─────────────────────────────────────────────────────

const proxyCmd = program.command('proxy').description('Manage the Semantic Caching Proxy');

proxyCmd
  .command('start')
  .description('Start the local Semantic Caching Proxy firewall')
  .option('-p, --port <number>', 'Port to listen on', '3739')
  .action((options) => {
    // Lazy require to avoid slowing down other commands
    const { startProxy } = require('./proxy');
    startProxy(parseInt(options.port, 10));
  });

// ─── Config ────────────────────────────────────────────────────

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (e.g., webhook_url)')
  .action((key, value) => {
    setConfig(key, value);
    console.log(chalk.green(`\nSet ${key} to ${value}\n`));
  });

configCmd
  .command('get <key>')
  .description('Get a configuration value')
  .action((key) => {
    const val = getConfig(key);
    if (val) {
      console.log(val);
    } else {
      console.log(chalk.yellow(`No config found for key: ${key}`));
    }
  });

// ─── Cloud Sync (Pro) ──────────────────────────────────────────

const cloudCmd = program.command('cloud').description('Manage Supabase Cloud Sync (Pro Feature)');

cloudCmd
  .command('login <email>')
  .description('Login to Supabase Cloud via Magic Link')
  .action((email) => {
    const { loginToCloud } = require('../pro/src/sync');
    loginToCloud(email);
  });

cloudCmd
  .command('verify <token>')
  .description('Verify magic link token')
  .action((token) => {
    const { verifyCloudToken } = require('../pro/src/sync');
    verifyCloudToken(token);
  });

cloudCmd
  .command('sync')
  .description('Sync local sessions to Supabase Cloud')
  .action(() => {
    const { syncSessionsToCloud } = require('../pro/src/sync');
    syncSessionsToCloud();
  });

// Only parse CLI args when run directly (not when imported as a library)
if (require.main === module) {
  program.parse();
}

// Programmatic API exports
export { createSession, getActiveSession, getActiveSessions, getActiveSessionForDir, endSession, getSession, getSessions, getStats, addFileChange, addCommit, addAIUsage, getFileChanges, getCommits, getAIUsage, exportSessions, loadPricing, setPricing, resetPricing, getPricingPath, addNote, getNotes, recoverStaleSessions, getSessionsPaginated, getSessionDetail, getDailyCosts, getModelBreakdown, getTopSessions, getProviderBreakdown, getFileHotspots, getActivityHeatmap, getDailyTokens, getCostVelocity, getProjectBreakdown, getTokenRatios } from './db';
export { initGit, startGitPolling, stopGitPolling, checkForNewCommits, getGitInfo, cleanupGit, getGitRoot, getGitHead, getGitDiffFiles, getGitLogCommits } from './git';
export { startWatcher, stopWatcher, cleanupWatcher } from './watcher';
export { Session, FileChange, Commit, AIUsage, SessionStats, SessionNote } from './types';
export { AgentSession, AgentSessionConfig, AgentSessionSummary, BudgetExceededError, runAgentSession } from './agents';
export { getLicense, isPro, activateLicense, deactivateLicense } from '../pro/src/license';
