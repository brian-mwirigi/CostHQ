import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetchApi, postApi } from '../api';
import { useInterval } from '../hooks/useInterval';
import { formatCost, formatDuration, formatTokens, formatDay } from '../utils/format';
import { IconSessions, IconDollar, IconClock, IconTrendUp, IconCircleDot, IconFile, IconGitCommit, IconActivity } from './Icons';

interface Stats {
  totalSessions: number;
  totalTime: number;
  totalFiles: number;
  totalCommits: number;
  totalAICost: number;
  avgSessionTime: number;
  activeSessions: number;
}

interface DailyCost {
  day: string;
  cost: number;
  sessions: number;
  tokens: number;
}

interface DailyToken {
  day: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface TopSession {
  id: number;
  name: string;
  aiCost: number;
  duration: number;
  startTime: string;
}

interface CostVelocityItem {
  id: number;
  name: string;
  startTime: string;
  duration: number;
  aiCost: number;
  costPerHour: number;
}

interface ModelBreakdownItem {
  provider: string;
  model: string;
  calls: number;
  totalCost: number;
}

interface ProxyStats {
  entries: number;
  hits: number;
  savedCost: number;
  storedCost: number;
}

interface Props {
  onSessionClick: (id: number) => void;
}

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1'];

export default function Overview({ onSessionClick }: Props) {
  const [days, setDays] = useState<number>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<DailyCost[]>([]);
  const [dailyTokens, setDailyTokens] = useState<DailyToken[]>([]);
  const [top, setTop] = useState<TopSession[]>([]);
  const [velocity, setVelocity] = useState<CostVelocityItem[]>([]);
  const [modelBreakdown, setModelBreakdown] = useState<ModelBreakdownItem[]>([]);
  const [proxyRunning, setProxyRunning] = useState(false);
  const [proxyStats, setProxyStats] = useState<ProxyStats | null>(null);
  const [togglingProxy, setTogglingProxy] = useState(false);

  const fetchProxyStatus = useCallback(async () => {
    try {
      const res = await fetchApi<{ running: boolean }>('/api/proxy/status');
      setProxyRunning(res.running);
      const statsRes = await fetchApi<ProxyStats>('/api/proxy/stats');
      setProxyStats(statsRes);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchAll = useCallback(() => {
    const daysStr = days === 0 ? '' : days.toString();
    const query = daysStr ? { days: daysStr } : undefined;
    
    fetchApi<Stats>('/api/stats', query).then(setStats).catch(console.error);
    fetchApi<DailyCost[]>('/api/daily-costs', query).then(setDaily).catch(console.error);
    fetchApi<DailyToken[]>('/api/daily-tokens', query).then(setDailyTokens).catch(console.error);
    fetchApi<TopSession[]>('/api/top-sessions', { limit: '5', ...(query || {}) }).then(setTop).catch(console.error);
    fetchApi<CostVelocityItem[]>('/api/cost-velocity', { limit: '20', ...(query || {}) }).then(setVelocity).catch(console.error);
    fetchApi<ModelBreakdownItem[]>('/api/model-breakdown', query).then(setModelBreakdown).catch(console.error);
    fetchProxyStatus();
  }, [days, fetchProxyStatus]);

  const toggleProxy = async () => {
    setTogglingProxy(true);
    try {
      const endpoint = proxyRunning ? '/proxy/stop' : '/proxy/start';
      const data = await postApi<{ success: boolean; running: boolean }>(endpoint);
      if (data.success) {
        setProxyRunning(data.running);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTogglingProxy(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useInterval(fetchAll, 30_000);

  if (!stats) return <div className="loading">Loading…</div>;

  const avgCost = stats.totalSessions > 0 ? stats.totalAICost / stats.totalSessions : 0;
  const totalDailyCost = daily.reduce((s, d) => s + d.cost, 0);
  const avgDailyCost = daily.length > 0 ? totalDailyCost / daily.length : 0;
  const projectedMonthly = avgDailyCost * 30;

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Overview</h1>
          <div className="page-subtitle">Aggregate metrics across all completed sessions</div>
        </div>
        <select 
          className="filter-select" 
          value={days} 
          onChange={(e) => setDays(Number(e.target.value))}
          style={{ width: 140 }}
        >
          <option value={7}>Last 7 Days</option>
          <option value={14}>Last 14 Days</option>
          <option value={30}>Last 30 Days</option>
          <option value={90}>Last 90 Days</option>
          <option value={0}>All Time</option>
        </select>
      </div>

      <div style={{ marginBottom: 24, display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, padding: '16px 24px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: 4 }}>CostHQ Margin Firewall</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Route requests through Port 3739 to enforce hard API budgets and block runaway loops.</div>
          </div>
          <button 
            onClick={toggleProxy} 
            disabled={togglingProxy}
            style={{
              background: proxyRunning ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${proxyRunning ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255,255,255,0.1)'}`,
              color: proxyRunning ? '#10b981' : 'var(--text-secondary)',
              padding: '8px 16px',
              borderRadius: '20px',
              cursor: togglingProxy ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: proxyRunning ? '#10b981' : 'var(--text-tertiary)', boxShadow: proxyRunning ? '0 0 8px #10b981' : 'none' }} />
            {togglingProxy ? 'Toggling...' : proxyRunning ? 'Firewall Active' : 'Firewall Inactive'}
          </button>
        </div>

        {proxyStats && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ width: 200, padding: '16px 24px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dollars Saved</div>
              <div style={{ fontWeight: 700, fontSize: '1.5rem', color: '#10b981' }}>{formatCost(proxyStats.savedCost)}</div>
            </div>
            <div style={{ width: 200, padding: '16px 24px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cache Hit Rate</div>
              <div style={{ fontWeight: 700, fontSize: '1.5rem', color: '#3b82f6' }}>{proxyStats.entries + proxyStats.hits > 0 ? Math.round((proxyStats.hits / (proxyStats.entries + proxyStats.hits)) * 100) : 0}%</div>
            </div>
          </div>
        )}
      </div>

      {/* All KPIs */}
      <div className="stat-row">
        <div className="stat-cell">
          <div className="stat-label"><IconSessions size={14} /> Sessions</div>
          <div className="stat-value">{stats.totalSessions}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><IconDollar size={14} /> Total Cost</div>
          <div className="stat-value">{formatCost(stats.totalAICost)}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><IconClock size={14} /> Total Time</div>
          <div className="stat-value">{formatDuration(stats.totalTime)}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><IconClock size={14} /> Avg Duration</div>
          <div className="stat-value">{formatDuration(Math.round(stats.avgSessionTime))}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><IconTrendUp size={14} /> Avg Cost</div>
          <div className="stat-value">{formatCost(avgCost)}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><IconFile size={14} /> Files Changed</div>
          <div className="stat-value">{stats.totalFiles}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label"><IconGitCommit size={14} /> Commits</div>
          <div className="stat-value">{stats.totalCommits}</div>
        </div>
        {stats.activeSessions > 0 && (
          <div className="stat-cell">
            <div className="stat-label"><IconCircleDot size={14} /> Active Now</div>
            <div className="stat-value">{stats.activeSessions}</div>
          </div>
        )}
      </div>

      {/* Burn rate projection */}
      {daily.length > 0 && (
        <div className="card" style={{ 
          marginBottom: 24, 
          background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.1), rgba(234, 179, 8, 0.02))', 
          borderColor: 'rgba(234, 179, 8, 0.2)',
          boxShadow: '0 4px 20px -2px rgba(234, 179, 8, 0.05)'
        }}>
          <div className="card-header" style={{ borderBottomColor: 'rgba(234, 179, 8, 0.1)' }}>
            <div className="card-title" style={{ color: '#facc15' }}>Spend Projection</div>
            <div className="card-meta" style={{ color: 'rgba(234, 179, 8, 0.6)' }}>based on last {daily.length} days</div>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 48, fontSize: 14 }}>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Avg daily: </span>
                <span className="mono" style={{ color: '#facc15', fontWeight: 600, fontSize: 16 }}>{formatCost(avgDailyCost)}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Projected monthly: </span>
                <span className="mono" style={{ color: projectedMonthly > 100 ? '#ef4444' : '#facc15', fontWeight: 700, fontSize: 16 }}>{formatCost(projectedMonthly)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Daily Cost */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Daily Cost</div>
          <div className="card-meta">last 30 days</div>
        </div>
        <div className="card-body">
          {daily.length === 0 ? (
            <div className="empty">No data yet — run some sessions first</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tickFormatter={formatDay} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `$${v}`} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
                <Tooltip content={<CostTooltip />} />
                <Area type="monotone" dataKey="cost" stroke="#22c55e" strokeWidth={1.5} fill="url(#costGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Daily Token Trend */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Daily Token Usage</div>
          <div className="card-meta">prompt vs completion</div>
        </div>
        <div className="card-body">
          {dailyTokens.length === 0 ? (
            <div className="empty">No token data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyTokens}>
                <XAxis dataKey="day" tickFormatter={formatDay} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => formatTokens(v)} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
                <Tooltip content={<TokenTooltip />} />
                <Bar dataKey="promptTokens" stackId="a" fill="#3b82f6" name="Prompt" />
                <Bar dataKey="completionTokens" stackId="a" fill="#8b5cf6" radius={[3, 3, 0, 0]} name="Completion" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Two-column */}
      <div className="grid grid--2">
        <div className="card">
          <div className="card-header"><div className="card-title">Sessions per Day</div></div>
          <div className="card-body">
            {daily.length === 0 ? (
              <div className="empty">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={daily}>
                  <XAxis dataKey="day" tickFormatter={formatDay} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
                  <Tooltip content={<SessionCountTooltip />} />
                  <Bar dataKey="sessions" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title">Most Expensive Sessions</div></div>
          <div className="card-body--flush">
            {top.length === 0 ? (
              <div className="empty">No sessions with cost yet</div>
            ) : (
              <table className="tbl tbl--compact tbl--clickable">
                <thead><tr><th>Session</th><th className="r">Cost</th><th className="r">Time</th></tr></thead>
                <tbody>
                  {top.map((s) => (
                    <tr key={s.id} onClick={() => onSessionClick(s.id)}>
                      <td className="ellipsis" title={s.name}>{s.name}</td>
                      <td className="r mono cost">{formatCost(s.aiCost)}</td>
                      <td className="r mono">{formatDuration(s.duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid--2">
        {/* Cost by Model */}
        {modelBreakdown.length > 0 && (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Cost by Model</div>
              <div className="card-meta">top models</div>
            </div>
            <div className="card-body">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={modelBreakdown.slice(0, 6)}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="totalCost"
                    stroke="none"
                  >
                    {modelBreakdown.slice(0, 6).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ModelTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Cost Velocity */}
      {velocity.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Cost Velocity</div>
            <div className="card-meta">$/hr per session</div>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={velocity.slice().reverse()}>
                <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={(v) => `$${v}`} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={45} />
                <Tooltip content={<VelocityTooltip />} />
                <Bar dataKey="costPerHour" fill="#eab308" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function CostTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      <div className="tt-value" style={{ color: '#22c55e' }}>Cost: {formatCost(payload[0].value)}</div>
    </div>
  );
}

function TokenTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="tt-value" style={{ color: p.color }}>{p.name}: {formatTokens(p.value)}</div>
      ))}
    </div>
  );
}

function SessionCountTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      <div className="tt-value" style={{ color: '#3b82f6' }}>Sessions: {payload[0].value}</div>
    </div>
  );
}

function VelocityTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{d.name}</div>
      <div className="tt-value">{formatCost(d.costPerHour)}/hr · {formatCost(d.aiCost)} total · {formatDuration(d.duration)}</div>
    </div>
  );
}

function ModelTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{d.model} <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>({d.provider})</span></div>
      <div className="tt-value" style={{ color: payload[0].payload.fill }}>{formatCost(d.totalCost)} · {d.calls} calls</div>
    </div>
  );
}
