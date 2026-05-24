import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetchApi } from '../api';
import { useInterval } from '../hooks/useInterval';
import { formatCost, formatDuration, formatTokens, formatDay } from '../utils/format';
import { IconSessions, IconDollar, IconClock, IconTrendUp, IconCircleDot, IconFile, IconGitCommit } from './Icons';

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

interface Props {
  onSessionClick: (id: number) => void;
}

export default function Overview({ onSessionClick }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<DailyCost[]>([]);
  const [dailyTokens, setDailyTokens] = useState<DailyToken[]>([]);
  const [top, setTop] = useState<TopSession[]>([]);
  const [velocity, setVelocity] = useState<CostVelocityItem[]>([]);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = useCallback(() => {
    fetchApi<Stats>('/api/stats').then(setStats).catch(console.error);
    fetchApi<DailyCost[]>('/api/daily-costs', { days: '30' }).then(setDaily).catch(console.error);
    fetchApi<DailyToken[]>('/api/daily-tokens', { days: '30' }).then(setDailyTokens).catch(console.error);
    fetchApi<TopSession[]>('/api/top-sessions', { limit: '5' }).then(setTop).catch(console.error);
    fetchApi<CostVelocityItem[]>('/api/cost-velocity', { limit: '20' }).then(setVelocity).catch(console.error);
  }, []);

  useInterval(fetchAll, 30_000);

  if (!stats) return <div className="loading">Loading…</div>;

  const avgCost = stats.totalSessions > 0 ? stats.totalAICost / stats.totalSessions : 0;
  const totalDailyCost = daily.reduce((s, d) => s + d.cost, 0);
  const avgDailyCost = daily.length > 0 ? totalDailyCost / daily.length : 0;
  const projectedMonthly = avgDailyCost * 30;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <div className="page-subtitle">Aggregate metrics across all completed sessions</div>
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
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">Spend Projection</div>
            <div className="card-meta">based on last {daily.length} days</div>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 32, fontSize: 13, color: 'var(--text-secondary)' }}>
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Avg daily: </span>
                <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatCost(avgDailyCost)}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Projected monthly: </span>
                <span className="mono" style={{ color: projectedMonthly > 100 ? 'var(--danger)' : 'var(--text-primary)', fontWeight: 600 }}>{formatCost(projectedMonthly)}</span>
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
