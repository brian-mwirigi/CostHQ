import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { createSession, endSession, getSession } from './db';
import { startProxy } from './proxy';
import { getGitRoot, getGitHead } from './git';

async function run() {
  try {
    const command = core.getInput('command', { required: true });
    const budgetLimitStr = core.getInput('budget_limit') || '1.00';
    const name = core.getInput('name') || 'CI-Run';

    const budgetLimit = parseFloat(budgetLimitStr);
    if (isNaN(budgetLimit)) {
      throw new Error(`Invalid budget_limit: ${budgetLimitStr}`);
    }

    core.info(`💰 Initializing Codesession Budget Breaker...`);
    core.info(`   Budget Limit: $${budgetLimit.toFixed(2)}`);

    const cwd = process.cwd();
    const gitRoot = await getGitRoot(cwd);
    const startHead = await getGitHead(cwd);

    // 1. Create Session
    const sessionId = createSession({
      name,
      startTime: new Date().toISOString(),
      workingDirectory: cwd,
      gitRoot: gitRoot || undefined,
      startGitHead: startHead || undefined,
      filesChanged: 0,
      commits: 0,
      aiCost: 0,
      aiTokens: 0,
      status: 'active',
    });

    // 2. Start Proxy to intercept and cache calls (reduces CI costs!)
    const proxyPort = 3739;
    startProxy(proxyPort);
    
    core.exportVariable('OPENAI_BASE_URL', `http://127.0.0.1:${proxyPort}/openai/v1`);
    core.exportVariable('ANTHROPIC_BASE_URL', `http://127.0.0.1:${proxyPort}/anthropic/v1`);
    
    core.info(`🛡️ Semantic Caching Proxy running on port ${proxyPort}`);

    // 3. Execute the user's command
    core.info(`🚀 Executing: ${command}`);
    
    let exitCode = 0;
    try {
      // Use bash or cmd depending on platform
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'cmd.exe' : '/bin/sh';
      const shellFlag = isWin ? '/c' : '-c';
      
      exitCode = await exec.exec(shell, [shellFlag, command], {
        env: { ...process.env } as Record<string, string>,
        ignoreReturnCode: true // We want to capture the code and evaluate the budget anyway
      });
    } catch (e: any) {
      exitCode = 1;
      core.error(`Command failed: ${e.message}`);
    }

    // 4. End Session and Audit Budget
    endSession(sessionId, new Date().toISOString(), 'CI run completed');
    const session = getSession(sessionId);

    if (!session) {
      throw new Error('Failed to retrieve session data after completion.');
    }

    const finalCost = session.aiCost || 0;

    core.info('==========================================');
    core.info('🧾 CODESESSION CI RECEIPT');
    core.info('==========================================');
    core.info(`Total API Cost:   $${finalCost.toFixed(4)}`);
    core.info(`Tokens Used:      ${session.aiTokens || 0}`);
    core.info(`Files Changed:    ${session.filesChanged || 0}`);
    core.info(`Command Exit:     ${exitCode}`);
    core.info('==========================================');

    // 5. Fail the build if budget exceeded
    if (finalCost > budgetLimit) {
      core.setFailed(`❌ BUDGET OVERRUN: The agent spent $${finalCost.toFixed(4)}, which exceeds the limit of $${budgetLimit.toFixed(2)}.`);
      return;
    }

    if (exitCode !== 0) {
      core.setFailed(`❌ Command failed with exit code ${exitCode}`);
      return;
    }

    core.info(`✅ Build passed. Budget safely maintained under $${budgetLimit.toFixed(2)}.`);

    // Force exit to ensure proxy server closes immediately in CI
    process.exit(0);
  } catch (error: any) {
    core.setFailed(`Action failed: ${error.message}`);
    process.exit(1);
  }
}

run();
