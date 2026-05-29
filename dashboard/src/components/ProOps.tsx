import { useEffect, useState } from 'react';
import { fetchApi, postApi } from '../api';
import { formatCost } from '../utils/format';
import { useLicense } from '../../../pro/dashboard/LicenseContext';
import UpgradePrompt from '../../../pro/dashboard/UpgradePrompt';
import { IconBell, IconDownload, IconRefreshCw, IconTarget, IconZap } from './Icons';

interface Policy {
  firewallEnabled: boolean;
  dailyLimit: number;
  totalLimit: number;
  sessionLimit: number;
  projectLimit: number;
  approvalCost: number;
  blockedModels: string[];
  teamBudgets: Array<{ name: string; match: string; limit: number }>;
  cacheEnabled: boolean;
  runawayEnabled: boolean;
  maxCostPerMinute: number;
}

interface CacheStats {
  entries: number;
  hits: number;
  savedCost: number;
  storedCost: number;
  lastHit?: string;
}

interface OpsSummary {
  policy: Policy;
  cache: CacheStats;
  projects: Array<{ project: string; totalCost: number; sessions: number }>;
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
} as const;

export default function ProOps() {
  const { isPro } = useLicense();
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');

  const load = () => {
    fetchApi<OpsSummary>('/api/pro/ops').then(setSummary).catch(console.error);
  };

  useEffect(() => { if (isPro) load(); }, [isPro]);

  if (!isPro) {
    return (
      <UpgradePrompt
        feature="Pro Control Plane"
        description="Unlock the spend firewall, Semantic Cache Pro, runaway agent detection, PR cost reports, and team or client budgets."
      />
    );
  }

  if (!summary) return <div className="page"><div className="loading">Loading Pro controls...</div></div>;

  const policy = summary.policy;

  const updatePolicy = async (patch: Partial<Policy>) => {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await postApi<Policy>('/api/pro/policy', patch);
      setSummary({ ...summary, policy: updated });
      setMessage('Policy saved');
    } catch {
      setMessage('Could not save policy');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 2500);
    }
  };

  const setNumber = (key: keyof Policy, value: string) => {
    updatePolicy({ [key]: parseFloat(value) || 0 } as Partial<Policy>);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Pro Control Plane</h1>
        <div className="page-subtitle">Control spend, catch runaway agents, and turn cache hits into visible savings.</div>
      </div>

      {message && <div className="alert-banner alert-banner--warning" style={{ marginBottom: 16 }}>{message}</div>}

      <div className="stat-row">
        <div className="stat-cell">
          <span className="stat-label"><IconTarget size={13} /> Firewall</span>
          <span className="stat-value">{policy.firewallEnabled ? 'On' : 'Off'}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconZap size={13} /> Cache Hits</span>
          <span className="stat-value mono">{summary.cache.hits}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconDownload size={13} /> Saved</span>
          <span className="stat-value mono cost">{formatCost(summary.cache.savedCost)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconBell size={13} /> Runaway</span>
          <span className="stat-value">{policy.runawayEnabled ? 'On' : 'Off'}</span>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Spend Firewall</div>
            <button className="modal-btn" disabled={saving} onClick={() => updatePolicy({ firewallEnabled: !policy.firewallEnabled })}>
              {policy.firewallEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <LabeledNumber label="Session limit" value={policy.sessionLimit} onBlur={(v) => setNumber('sessionLimit', v)} />
            <LabeledNumber label="Daily limit" value={policy.dailyLimit} onBlur={(v) => setNumber('dailyLimit', v)} />
            <LabeledNumber label="Project limit" value={policy.projectLimit} onBlur={(v) => setNumber('projectLimit', v)} />
            <LabeledNumber label="Approval threshold" value={policy.approvalCost} onBlur={(v) => setNumber('approvalCost', v)} />
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="card-meta">Blocked models</span>
              <input
                style={inputStyle}
                defaultValue={policy.blockedModels.join(', ')}
                onBlur={(e) => updatePolicy({ blockedModels: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="claude-opus, gpt-5.2-pro"
              />
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Semantic Cache Pro</div>
            <button className="modal-btn" disabled={saving} onClick={() => updatePolicy({ cacheEnabled: !policy.cacheEnabled })}>
              {policy.cacheEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
          <div className="card-body">
            <table className="tbl tbl--compact">
              <tbody>
                <tr><td>Stored responses</td><td className="r mono">{summary.cache.entries}</td></tr>
                <tr><td>Cache hits</td><td className="r mono">{summary.cache.hits}</td></tr>
                <tr><td>Saved cost</td><td className="r mono cost">{formatCost(summary.cache.savedCost)}</td></tr>
                <tr><td>Last hit</td><td className="r mono">{summary.cache.lastHit || 'never'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Runaway Detection</div>
            <button className="modal-btn" disabled={saving} onClick={() => updatePolicy({ runawayEnabled: !policy.runawayEnabled })}>
              {policy.runawayEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <LabeledNumber label="Max cost per minute" value={policy.maxCostPerMinute} onBlur={(v) => setNumber('maxCostPerMinute', v)} />
            <div className="card-meta">Use session detail or `cs pro runaway` to inspect active sessions.</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Team / Client Budgets</div>
            <IconRefreshCw size={16} />
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const [name, match, limitRaw] = budgetDraft.split(':');
                const limit = parseFloat(limitRaw);
                if (!name || !match || !Number.isFinite(limit)) return;
                updatePolicy({ teamBudgets: [...policy.teamBudgets.filter(b => b.name !== name), { name, match, limit }] } as Partial<Policy>);
                setBudgetDraft('');
              }}
              style={{ display: 'flex', gap: 8 }}
            >
              <input style={inputStyle} value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} placeholder="Client:repo-or-path:25" />
              <button className="modal-btn modal-btn--primary" disabled={saving}>Add</button>
            </form>
            {policy.teamBudgets.length > 0 && (
              <table className="tbl tbl--compact">
                <tbody>
                  {policy.teamBudgets.map(b => (
                    <tr key={b.name}>
                      <td>{b.name}</td>
                      <td className="mono">{b.match}</td>
                      <td className="r mono">{formatCost(b.limit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card-body--flush">
            <table className="tbl tbl--compact">
              <thead><tr><th>Project</th><th className="r">Sessions</th><th className="r">Cost</th></tr></thead>
              <tbody>
                {summary.projects.map(p => (
                  <tr key={p.project}>
                    <td className="ellipsis mono" title={p.project}>{p.project}</td>
                    <td className="r mono">{p.sessions}</td>
                    <td className="r mono cost">{formatCost(p.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function LabeledNumber({ label, value, onBlur }: { label: string; value: number; onBlur: (value: string) => void }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span className="card-meta">{label}</span>
      <input type="number" min="0" step="0.01" style={inputStyle} defaultValue={value || ''} placeholder="0 = disabled" onBlur={(e) => onBlur(e.target.value)} />
    </label>
  );
}
