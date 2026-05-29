import {
  getConfig,
  setConfig,
  getSessionDetail,
  getSpendPolicyStats,
  getProxyCacheStats,
  getProjectBreakdown,
  getTokenRatios,
} from '../../src/db';
import type { Session } from '../../src/types';

const POLICY_KEY = 'pro_policy';

export interface TeamBudget {
  name: string;
  match: string;
  limit: number;
}

export interface ProPolicy {
  firewallEnabled: boolean;
  dailyLimit: number;
  totalLimit: number;
  sessionLimit: number;
  projectLimit: number;
  approvalCost: number;
  blockedModels: string[];
  teamBudgets: TeamBudget[];
  cacheEnabled: boolean;
  cacheTtlHours: number;
  runawayEnabled: boolean;
  maxCostPerMinute: number;
  maxRepeatedModelCalls: number;
  maxFileTouches: number;
}

export interface PolicyViolation {
  code: string;
  message: string;
  projectedCost?: number;
  limit?: number;
}

export const DEFAULT_PRO_POLICY: ProPolicy = {
  firewallEnabled: false,
  dailyLimit: 0,
  totalLimit: 0,
  sessionLimit: 0,
  projectLimit: 0,
  approvalCost: 0,
  blockedModels: [],
  teamBudgets: [],
  cacheEnabled: true,
  cacheTtlHours: 168,
  runawayEnabled: true,
  maxCostPerMinute: 2,
  maxRepeatedModelCalls: 12,
  maxFileTouches: 20,
};

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getProPolicy(): ProPolicy {
  const raw = getConfig(POLICY_KEY);
  if (!raw) return { ...DEFAULT_PRO_POLICY };
  try {
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PRO_POLICY,
      ...parsed,
      dailyLimit: numeric(parsed.dailyLimit, DEFAULT_PRO_POLICY.dailyLimit),
      totalLimit: numeric(parsed.totalLimit, DEFAULT_PRO_POLICY.totalLimit),
      sessionLimit: numeric(parsed.sessionLimit, DEFAULT_PRO_POLICY.sessionLimit),
      projectLimit: numeric(parsed.projectLimit, DEFAULT_PRO_POLICY.projectLimit),
      approvalCost: numeric(parsed.approvalCost, DEFAULT_PRO_POLICY.approvalCost),
      cacheTtlHours: numeric(parsed.cacheTtlHours, DEFAULT_PRO_POLICY.cacheTtlHours),
      maxCostPerMinute: numeric(parsed.maxCostPerMinute, DEFAULT_PRO_POLICY.maxCostPerMinute),
      maxRepeatedModelCalls: Math.max(1, Math.floor(numeric(parsed.maxRepeatedModelCalls, DEFAULT_PRO_POLICY.maxRepeatedModelCalls))),
      maxFileTouches: Math.max(1, Math.floor(numeric(parsed.maxFileTouches, DEFAULT_PRO_POLICY.maxFileTouches))),
      blockedModels: Array.isArray(parsed.blockedModels) ? parsed.blockedModels.map(String) : [],
      teamBudgets: Array.isArray(parsed.teamBudgets)
        ? parsed.teamBudgets
            .filter((b: any) => b && typeof b.name === 'string' && typeof b.match === 'string')
            .map((b: any) => ({ name: b.name, match: b.match, limit: numeric(b.limit, 0) }))
        : [],
    };
  } catch {
    return { ...DEFAULT_PRO_POLICY };
  }
}

export function saveProPolicy(policy: Partial<ProPolicy>): ProPolicy {
  const merged = { ...getProPolicy(), ...policy };
  setConfig(POLICY_KEY, JSON.stringify(merged));
  return merged;
}

export function checkSpendPolicy(input: {
  session: Session;
  provider: string;
  model: string;
  cost: number;
  allowApproval?: boolean;
}): PolicyViolation[] {
  const policy = getProPolicy();
  if (!policy.firewallEnabled) return [];

  const modelKey = `${input.provider}/${input.model}`.toLowerCase();
  const plainModel = input.model.toLowerCase();
  const violations: PolicyViolation[] = [];
  const project = input.session.gitRoot || input.session.workingDirectory;
  const stats = getSpendPolicyStats(project);
  const projectedSession = input.session.aiCost + input.cost;
  const projectedDaily = stats.todayCost + input.cost;
  const projectedTotal = stats.totalCost + input.cost;
  const projectedProject = stats.projectCost + input.cost;

  if (policy.blockedModels.some(m => {
    const needle = m.toLowerCase();
    return needle === plainModel || needle === modelKey || plainModel.includes(needle);
  })) {
    violations.push({ code: 'model_blocked', message: `${input.provider}/${input.model} is blocked by Pro spend firewall` });
  }

  if (policy.approvalCost > 0 && input.cost >= policy.approvalCost && !input.allowApproval) {
    violations.push({ code: 'approval_required', message: `This AI call costs $${input.cost.toFixed(4)} and requires approval`, projectedCost: input.cost, limit: policy.approvalCost });
  }
  if (policy.sessionLimit > 0 && projectedSession > policy.sessionLimit) {
    violations.push({ code: 'session_limit', message: `Session would reach $${projectedSession.toFixed(4)}, over the $${policy.sessionLimit.toFixed(2)} limit`, projectedCost: projectedSession, limit: policy.sessionLimit });
  }
  if (policy.dailyLimit > 0 && projectedDaily > policy.dailyLimit) {
    violations.push({ code: 'daily_limit', message: `Today would reach $${projectedDaily.toFixed(4)}, over the $${policy.dailyLimit.toFixed(2)} limit`, projectedCost: projectedDaily, limit: policy.dailyLimit });
  }
  if (policy.totalLimit > 0 && projectedTotal > policy.totalLimit) {
    violations.push({ code: 'total_limit', message: `All-time spend would reach $${projectedTotal.toFixed(4)}, over the $${policy.totalLimit.toFixed(2)} limit`, projectedCost: projectedTotal, limit: policy.totalLimit });
  }
  if (policy.projectLimit > 0 && projectedProject > policy.projectLimit) {
    violations.push({ code: 'project_limit', message: `Project spend would reach $${projectedProject.toFixed(4)}, over the $${policy.projectLimit.toFixed(2)} limit`, projectedCost: projectedProject, limit: policy.projectLimit });
  }

  for (const budget of policy.teamBudgets) {
    if (budget.limit > 0 && project.toLowerCase().includes(budget.match.toLowerCase()) && projectedProject > budget.limit) {
      violations.push({ code: 'team_budget', message: `${budget.name} budget would reach $${projectedProject.toFixed(4)}, over the $${budget.limit.toFixed(2)} limit`, projectedCost: projectedProject, limit: budget.limit });
    }
  }

  return violations;
}

export function analyzeRunawaySession(sessionId: number) {
  const policy = getProPolicy();
  const detail = getSessionDetail(sessionId);
  if (!detail) return null;

  const alerts: PolicyViolation[] = [];
  const durationSeconds = detail.session.duration || Math.max(1, Math.floor((Date.now() - new Date(detail.session.startTime).getTime()) / 1000));
  const costPerMinute = detail.session.aiCost / Math.max(durationSeconds / 60, 1);

  if (policy.runawayEnabled && policy.maxCostPerMinute > 0 && costPerMinute > policy.maxCostPerMinute) {
    alerts.push({ code: 'cost_velocity', message: `Cost velocity is $${costPerMinute.toFixed(2)}/min`, projectedCost: costPerMinute, limit: policy.maxCostPerMinute });
  }

  const recentModels = detail.aiUsage.slice(-policy.maxRepeatedModelCalls);
  if (policy.runawayEnabled && recentModels.length >= policy.maxRepeatedModelCalls) {
    const sameModel = recentModels.every(u => `${u.provider}/${u.model}` === `${recentModels[0].provider}/${recentModels[0].model}`);
    if (sameModel) {
      alerts.push({ code: 'repeat_calls', message: `${recentModels.length} consecutive calls hit ${recentModels[0].provider}/${recentModels[0].model}` });
    }
  }

  const fileTouches = new Map<string, number>();
  for (const f of detail.files) fileTouches.set(f.filePath, (fileTouches.get(f.filePath) || 0) + 1);
  const churn = [...fileTouches.entries()].filter(([, count]) => count >= policy.maxFileTouches);
  if (policy.runawayEnabled && churn.length > 0) {
    alerts.push({ code: 'file_churn', message: `${churn[0][0]} was touched ${churn[0][1]} times` });
  }

  return {
    session: detail.session,
    costPerMinute: Math.round(costPerMinute * 10000) / 10000,
    alerts,
  };
}

export function getProOpsSummary() {
  return {
    policy: getProPolicy(),
    cache: getProxyCacheStats(),
    projects: getProjectBreakdown().slice(0, 10),
    tokenRatios: getTokenRatios().slice(0, 10),
  };
}

export function generatePrReport(sessionId: number): string | null {
  const detail = getSessionDetail(sessionId);
  if (!detail) return null;
  const cache = getProxyCacheStats();
  const runaway = analyzeRunawaySession(sessionId);
  const models = new Map<string, { tokens: number; cost: number; calls: number }>();
  for (const u of detail.aiUsage) {
    const key = `${u.provider}/${u.model}`;
    const row = models.get(key) || { tokens: 0, cost: 0, calls: 0 };
    row.tokens += u.tokens;
    row.cost += u.cost;
    row.calls += 1;
    models.set(key, row);
  }

  const modelRows = [...models.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([model, row]) => `| ${model} | ${row.calls} | ${row.tokens.toLocaleString()} | $${row.cost.toFixed(4)} |`)
    .join('\n') || '| None | 0 | 0 | $0.0000 |';

  const alerts = runaway?.alerts.length
    ? runaway.alerts.map(a => `- ${a.message}`).join('\n')
    : '- No runaway patterns detected.';

  return [
    '## CodeSession AI Cost Report',
    '',
    `Session: **${detail.session.name}**`,
    `Status: **${detail.session.status}**`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| AI cost | $${detail.session.aiCost.toFixed(4)} |`,
    `| Tokens | ${detail.session.aiTokens.toLocaleString()} |`,
    `| Files changed | ${detail.session.filesChanged} |`,
    `| Commits | ${detail.session.commits} |`,
    `| Cache savings | $${cache.savedCost.toFixed(4)} |`,
    '',
    '### Model Breakdown',
    '| Model | Calls | Tokens | Cost |',
    '|---|---:|---:|---:|',
    modelRows,
    '',
    '### Runaway Checks',
    alerts,
    '',
    '_Generated by CodeSession Pro._',
  ].join('\n');
}
