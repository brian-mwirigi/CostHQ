import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../api';
import { useInterval } from '../hooks/useInterval';
import { formatCost, formatTokens } from '../utils/format';
import { IconModels, IconDollar, IconToken, IconHash } from './Icons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

interface ModelRow {
  model: string;
  provider: string;
  totalTokens: number;
  totalCost: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

interface ProviderRow {
  provider: string;
  totalCost: number;
  totalTokens: number;
  calls: number;
  models: number;
}

interface TokenRatio {
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  ratio: number;
  calls: number;
}

const COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: p.color }} />
          {p.name}: {typeof p.value === 'number' && p.value < 1 ? formatCost(p.value) : formatTokens(p.value)}
        </div>
      ))}
    </div>
  );
};

export default function ModelBreakdown() {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [ratios, setRatios] = useState<TokenRatio[]>([]);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = useCallback(() => {
    fetchApi<ModelRow[]>('/api/model-breakdown').then(setModels).catch(console.error);
    fetchApi<ProviderRow[]>('/api/provider-breakdown').then(setProviders).catch(console.error);
    fetchApi<TokenRatio[]>('/api/token-ratios').then(setRatios).catch(console.error);
  }, []);

  useInterval(fetchAll, 30_000);

  const totalCost = models.reduce((s, m) => s + m.totalCost, 0);
  const totalTokens = models.reduce((s, m) => s + m.totalTokens, 0);
  const totalCalls = models.reduce((s, m) => s + m.calls, 0);

  const costPie = models
    .filter(m => m.totalCost > 0)
    .map(m => ({ name: m.model, value: m.totalCost }))
    .sort((a, b) => b.value - a.value);

  const tokenBar = models
    .map(m => ({
      model: m.model.length > 20 ? m.model.slice(0, 18) + '\u2026' : m.model,
      prompt: m.promptTokens,
      completion: m.completionTokens,
    }))
    .sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion))
    .slice(0, 10);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Models & Providers</h1>
        <div className="page-subtitle">AI usage breakdown by model and provider</div>
      </div>

      {/* Top-level KPIs */}
      <div className="stat-row">
        <div className="stat-cell">
          <span className="stat-label"><IconModels size={13} /> Models Used</span>
          <span className="stat-value">{models.length}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconHash size={13} /> Total Calls</span>
          <span className="stat-value mono">{totalCalls.toLocaleString()}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconToken size={13} /> Total Tokens</span>
          <span className="stat-value mono">{formatTokens(totalTokens)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconDollar size={13} /> Total Cost</span>
          <span className="stat-value mono cost">{formatCost(totalCost)}</span>
        </div>
      </div>

      {/* Provider Summary */}
      {providers.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">Provider Summary</span></div>
          <div className="card-body--flush">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className="r">Models</th>
                  <th className="r">Calls</th>
                  <th className="r">Tokens</th>
                  <th className="r">Cost</th>
                  <th className="r">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.provider}</td>
                    <td className="r mono">{p.models}</td>
                    <td className="r mono">{p.calls.toLocaleString()}</td>
                    <td className="r mono">{formatTokens(p.totalTokens)}</td>
                    <td className="r mono cost">{formatCost(p.totalCost)}</td>
                    <td className="r mono">{totalCost > 0 ? ((p.totalCost / totalCost) * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid--2">
        <div className="card">
          <div className="card-header"><span className="card-title">Cost by Model</span></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={costPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {costPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend formatter={(v: string) => <span className="legend-label">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Token Usage by Model (Top 10)</span></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tokenBar} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} />
                <YAxis type="category" dataKey="model" tick={{ fill: '#a1a1aa', fontSize: 11 }} width={100} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="prompt" name="Prompt" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
                <Bar dataKey="completion" name="Completion" stackId="a" fill="#06b6d4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Token Ratio Analysis */}
      {ratios.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">Prompt:Completion Ratio by Model</span></div>
          <div className="card-body--flush">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th className="r">Prompt Tokens</th>
                  <th className="r">Completion Tokens</th>
                  <th className="r">Ratio</th>
                  <th>Distribution</th>
                </tr>
              </thead>
              <tbody>
                {ratios.map((r, i) => {
                  const total = r.promptTokens + r.completionTokens;
                  const promptPct = total > 0 ? (r.promptTokens / total) * 100 : 50;
                  return (
                    <tr key={i}>
                      <td className="mono">{r.provider}</td>
                      <td className="mono">{r.model}</td>
                      <td className="r mono">{formatTokens(r.promptTokens)}</td>
                      <td className="r mono">{formatTokens(r.completionTokens)}</td>
                      <td className="r mono">{r.ratio?.toFixed(2) ?? '—'}x</td>
                      <td>
                        <div className="ratio-bar">
                          <div className="ratio-bar-prompt" style={{ width: `${promptPct}%` }} title={`Prompt: ${promptPct.toFixed(1)}%`} />
                          <div className="ratio-bar-completion" style={{ width: `${100 - promptPct}%` }} title={`Completion: ${(100 - promptPct).toFixed(1)}%`} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full Model Breakdown Table */}
      <div className="card">
        <div className="card-header"><span className="card-title">All Models</span></div>
        <div className="card-body--flush">
          <table className="tbl">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th className="r">Calls</th>
                <th className="r">Prompt</th>
                <th className="r">Completion</th>
                <th className="r">Total Tokens</th>
                <th className="r">Cost</th>
                <th className="r">Avg Cost/Call</th>
              </tr>
            </thead>
            <tbody>
              {models
                .sort((a, b) => b.totalCost - a.totalCost)
                .map((m, i) => (
                  <tr key={i}>
                    <td className="mono">{m.provider}</td>
                    <td className="mono">{m.model}</td>
                    <td className="r mono">{m.calls.toLocaleString()}</td>
                    <td className="r mono">{formatTokens(m.promptTokens)}</td>
                    <td className="r mono">{formatTokens(m.completionTokens)}</td>
                    <td className="r mono">{formatTokens(m.totalTokens)}</td>
                    <td className="r mono cost">{formatCost(m.totalCost)}</td>
                    <td className="r mono">{formatCost(m.calls > 0 ? m.totalCost / m.calls : 0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
