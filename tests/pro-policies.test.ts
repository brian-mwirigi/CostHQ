import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData, createSession, addAIUsage, addFileChange, setConfig } from '../src/db';
import {
  DEFAULT_PRO_POLICY,
  getProPolicy,
  saveProPolicy,
  checkSpendPolicy,
  analyzeRunawaySession,
  generatePrReport
} from '../pro/src/policies';

beforeEach(() => {
  clearAllData();
  setConfig('pro_policy', '');
});

describe('Pro Policies Configuration', () => {
  it('getProPolicy returns defaults when no config is set', () => {
    const policy = getProPolicy();
    expect(policy).toEqual(DEFAULT_PRO_POLICY);
  });

  it('saveProPolicy merges partial updates correctly', () => {
    saveProPolicy({ firewallEnabled: true, dailyLimit: 50 });
    const policy = getProPolicy();
    expect(policy.firewallEnabled).toBe(true);
    expect(policy.dailyLimit).toBe(50);
    // Other defaults should remain intact
    expect(policy.maxCostPerMinute).toBe(DEFAULT_PRO_POLICY.maxCostPerMinute);
  });
});

describe('checkSpendPolicy (Firewall)', () => {
  it('returns empty array if firewall is disabled', () => {
    saveProPolicy({ firewallEnabled: false, dailyLimit: 0.1 });
    const session = { aiCost: 0, gitRoot: '/test', workingDirectory: '/test' } as any;
    const violations = checkSpendPolicy({ session, provider: 'openai', model: 'gpt-4o', cost: 10 });
    expect(violations.length).toBe(0);
  });

  it('blocks specific models by exact and partial match', () => {
    saveProPolicy({ firewallEnabled: true, blockedModels: ['claude-opus', 'gpt-5'] });
    const session = { aiCost: 0, gitRoot: '/test', workingDirectory: '/test' } as any;
    
    // Exact match
    const v1 = checkSpendPolicy({ session, provider: 'anthropic', model: 'claude-opus', cost: 0.1 });
    expect(v1.some(v => v.code === 'model_blocked')).toBe(true);
    
    // Partial match (e.g. gpt-5.2)
    const v2 = checkSpendPolicy({ session, provider: 'openai', model: 'gpt-5.2-pro', cost: 0.1 });
    expect(v2.some(v => v.code === 'model_blocked')).toBe(true);
    
    // Allowed model
    const v3 = checkSpendPolicy({ session, provider: 'openai', model: 'gpt-4o', cost: 0.1 });
    expect(v3.some(v => v.code === 'model_blocked')).toBe(false);
  });

  it('enforces approval cost thresholds', () => {
    saveProPolicy({ firewallEnabled: true, approvalCost: 5.0 });
    const session = { aiCost: 0, gitRoot: '/test', workingDirectory: '/test' } as any;
    
    // Cost below threshold
    expect(checkSpendPolicy({ session, provider: 'openai', model: 'm', cost: 2.0 }).length).toBe(0);
    
    // Cost above threshold
    const v = checkSpendPolicy({ session, provider: 'openai', model: 'm', cost: 6.0 });
    expect(v.some(v => v.code === 'approval_required')).toBe(true);
    
    // Cost above threshold but allowApproval flag is true
    expect(checkSpendPolicy({ session, provider: 'openai', model: 'm', cost: 6.0, allowApproval: true }).length).toBe(0);
  });

  it('enforces session limits', () => {
    saveProPolicy({ firewallEnabled: true, sessionLimit: 10.0 });
    const session = { aiCost: 9.0, gitRoot: '/test', workingDirectory: '/test' } as any;
    
    // 9.0 + 0.5 = 9.5 (OK)
    expect(checkSpendPolicy({ session, provider: 'p', model: 'm', cost: 0.5 }).length).toBe(0);
    
    // 9.0 + 1.5 = 10.5 (Violates limit)
    const v = checkSpendPolicy({ session, provider: 'p', model: 'm', cost: 1.5 });
    expect(v.some(v => v.code === 'session_limit')).toBe(true);
  });

  it('enforces team budget limits by path matching', () => {
    saveProPolicy({ 
      firewallEnabled: true, 
      teamBudgets: [{ name: 'Frontend Team', match: '/frontend', limit: 20 }] 
    });
    
    // Simulate previous DB spend
    const id = createSession({ name: 'prev', startTime: new Date().toISOString(), workingDirectory: '/frontend', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 100, cost: 15.0, timestamp: new Date().toISOString() });
    
    const session = { aiCost: 0, gitRoot: '/frontend', workingDirectory: '/frontend' } as any;
    
    // 15.0 + 4.0 = 19.0 (OK)
    expect(checkSpendPolicy({ session, provider: 'p', model: 'm', cost: 4.0 }).length).toBe(0);
    
    // 15.0 + 6.0 = 21.0 (Violates budget)
    const v = checkSpendPolicy({ session, provider: 'p', model: 'm', cost: 6.0 });
    expect(v.some(v => v.code === 'team_budget')).toBe(true);
  });
});

describe('Runaway Agent Detection', () => {
  it('detects cost velocity runaways (maxCostPerMinute)', () => {
    saveProPolicy({ runawayEnabled: true, maxCostPerMinute: 2.0 });
    // Simulate a session that started 10 seconds ago but spent $1.00
    // That's $6.00/min velocity, which exceeds $2.00/min.
    const start = new Date(Date.now() - 10000).toISOString();
    const id = createSession({ name: 'fast', startTime: start, workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    addAIUsage({ sessionId: id, provider: 'p', model: 'm', tokens: 100, cost: 3.0, timestamp: new Date().toISOString() });
    
    const runaway = analyzeRunawaySession(id);
    expect(runaway).not.toBeNull();
    expect(runaway!.alerts.some(a => a.code === 'cost_velocity')).toBe(true);
  });

  it('detects repeated model calls', () => {
    saveProPolicy({ runawayEnabled: true, maxRepeatedModelCalls: 3 });
    const id = createSession({ name: 'loop', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    
    // Add 3 identical calls
    for (let i=0; i<3; i++) {
      addAIUsage({ sessionId: id, provider: 'openai', model: 'gpt-4o', tokens: 100, cost: 0.1, timestamp: new Date().toISOString() });
    }
    
    const runaway = analyzeRunawaySession(id);
    expect(runaway!.alerts.some(a => a.code === 'repeat_calls')).toBe(true);
  });

  it('detects excessive file churn', () => {
    saveProPolicy({ runawayEnabled: true, maxFileTouches: 5 });
    const id = createSession({ name: 'churn', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'active' });
    
    // Modify the same file 5 times
    for (let i=0; i<5; i++) {
      addFileChange({ sessionId: id, filePath: 'index.ts', changeType: 'modified', timestamp: new Date().toISOString() });
    }
    
    const runaway = analyzeRunawaySession(id);
    expect(runaway!.alerts.some(a => a.code === 'file_churn')).toBe(true);
  });
});

describe('generatePrReport', () => {
  it('generates a markdown report for a session', () => {
    const id = createSession({ name: 'report-session', startTime: new Date().toISOString(), workingDirectory: '/w', filesChanged: 0, commits: 0, aiCost: 0, aiTokens: 0, status: 'completed' });
    addAIUsage({ sessionId: id, provider: 'anthropic', model: 'claude-3.5-sonnet', tokens: 1000, cost: 0.015, timestamp: new Date().toISOString() });
    
    const report = generatePrReport(id);
    expect(report).not.toBeNull();
    expect(report).toContain('CodeSession AI Cost Report');
    expect(report).toContain('claude-3.5-sonnet');
    expect(report).toContain('report-session');
  });
});
