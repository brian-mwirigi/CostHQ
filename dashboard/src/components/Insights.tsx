import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../api';
import { useInterval } from '../hooks/useInterval';
import { formatCost, formatTokens } from '../utils/format';
import { IconTarget, IconZap, IconCpu, IconBarChart, IconFolder } from './Icons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

interface FileHotspot {
  filePath: string;
  sessionCount: number;
  changeCount: number;
  lastChanged: string;
  creates: number;
  modifies: number;
  deletes: number;
}

interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  sessions: number;
  cost: number;
}

interface ProjectRow {
  project: string;
  sessions: number;
  totalCost: number;
  totalTokens: number;
  totalTime: number;
  totalFiles: number;
  totalCommits: number;
  lastActive: string;
}

interface PricingEntry {
  input: number;
  output: number;
}

type PricingMap = Record<string, PricingEntry>;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: p.color }} />
          {p.name}: {(p.value ?? 0).toLocaleString()}
        </div>
      ))}
    </div>
  );
};

export default function Insights() {
  const [hotspots, setHotspots] = useState<FileHotspot[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [pricing, setPricing] = useState<PricingMap>({});
  const [tab, setTab] = useState<'hotspots' | 'heatmap' | 'projects' | 'pricing'>('hotspots');
  const [isPro, setIsPro] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');

  const fetchAll = useCallback(() => {
    fetchApi<FileHotspot[]>('/api/file-hotspots').then(setHotspots);
    fetchApi<HeatmapCell[]>('/api/activity-heatmap').then(setHeatmap);
    fetchApi<ProjectRow[]>('/api/projects').then(setProjects);
    fetchApi<PricingMap>('/api/pricing').then(setPricing);
  }, []);

  useEffect(() => {
    if (localStorage.getItem('cs-pro-key')) {
      setIsPro(true);
    }
    fetchAll();
  }, [fetchAll]);

  useInterval(fetchAll, 30_000);

  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');

  const unlockPro = () => {
    if (!licenseKey.trim()) return;
    setIsValidating(true);
    setError('');
    
    // Simulate network validation
    setTimeout(() => {
      if (licenseKey.trim().toUpperCase().startsWith('CS-PRO-')) {
        localStorage.setItem('cs-pro-key', licenseKey.trim().toUpperCase());
        setIsPro(true);
      } else {
        setError('Invalid license key. Please check your purchase email.');
      }
      setIsValidating(false);
    }, 800);
  };

  const tabs = [
    { key: 'hotspots' as const, label: 'File Hotspots', icon: <IconTarget size={14} />, count: hotspots.length },
    { key: 'heatmap' as const, label: 'Activity', icon: <IconZap size={14} /> },
    { key: 'projects' as const, label: 'Projects', icon: <IconFolder size={14} />, count: projects.length },
    { key: 'pricing' as const, label: 'Pricing', icon: <IconCpu size={14} />, count: Object.keys(pricing).length },
  ];

  // Build heatmap grid
  const heatmapGrid: Record<string, number> = {};
  let maxSessions = 1;
  heatmap.forEach(c => {
    const key = `${c.dayOfWeek}-${c.hour}`;
    heatmapGrid[key] = c.sessions;
    if (c.sessions > maxSessions) maxSessions = c.sessions;
  });

  // Project bar chart
  const projectChartData = projects
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 10)
    .map(p => ({
      name: p.project.split(/[/\\]/).pop() || p.project,
      cost: p.totalCost,
      sessions: p.sessions,
    }));

  return (
    <div className="page" style={{ position: 'relative' }}>
      <div className="page-header">
        <h1 className="page-title">Insights</h1>
        <div className="page-subtitle">Deep analytics across all sessions</div>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {tabs.map(t => (
          <button
            key={t.key}
            className={`tab-btn${tab === t.key ? ' tab-btn--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.icon} {t.label} {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {!isPro && (
        <div style={{
          position: 'absolute',
          top: 150,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(9, 9, 11, 0.7)',
          backdropFilter: 'blur(8px)',
          borderRadius: 12
        }}>
          <div style={{
            background: 'var(--bg-root)',
            padding: '32px 40px',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            textAlign: 'center',
            maxWidth: '440px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'var(--bg-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              border: '1px solid var(--border)'
            }}>
              <IconZap size={20} color="var(--text-primary)" />
            </div>

            <h2 style={{ 
              margin: '0 0 12px', 
              fontSize: '20px', 
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}>
              Unlock Advanced Insights
            </h2>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5, marginBottom: '28px' }}>
              Upgrade to Codesession Pro to access detailed file hotspots, activity heatmaps, and project cost breakdowns.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input 
                type="text" 
                placeholder="Enter license key (e.g. CS-PRO-1234)" 
                value={licenseKey}
                onChange={e => { setLicenseKey(e.target.value); setError(''); }}
                disabled={isValidating}
                style={{
                  width: '100%',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  outline: 'none',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
              {error && <div style={{ color: '#f85149', fontSize: '13px', textAlign: 'left', marginTop: '-4px' }}>{error}</div>}
              <button 
                onClick={unlockPro}
                disabled={isValidating || !licenseKey.trim()}
                style={{
                  width: '100%',
                  background: 'var(--text-primary)',
                  color: 'var(--bg-root)',
                  border: 'none',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  cursor: (isValidating || !licenseKey.trim()) ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontSize: '14px',
                  opacity: (isValidating || !licenseKey.trim()) ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                {isValidating ? 'Validating...' : 'Unlock Pro'}
              </button>
            </div>
            
            <div style={{ marginTop: '24px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Don't have a key? </span>
              <a href="#" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500 }}>
                Get one here &rarr;
              </a>
            </div>
          </div>
        </div>
      )}

      <div style={{ filter: isPro ? 'none' : 'blur(8px)', opacity: isPro ? 1 : 0.6, pointerEvents: isPro ? 'auto' : 'none', transition: 'filter 0.3s' }}>
      {tab === 'hotspots' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Most Changed Files Across Sessions</span>
          </div>
          <div className="card-body--flush">
            {hotspots.length === 0 ? (
              <div className="empty-state">No file change data recorded yet</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>File Path</th>
                    <th className="r">Sessions</th>
                    <th className="r">Changes</th>
                    <th className="r">Creates</th>
                    <th className="r">Modifies</th>
                    <th className="r">Deletes</th>
                    <th>Churn</th>
                  </tr>
                </thead>
                <tbody>
                  {hotspots.map((f, i) => {
                    const maxChurn = hotspots[0]?.changeCount || 1;
                    const pct = (f.changeCount / maxChurn) * 100;
                    return (
                      <tr key={i}>
                        <td className="mono ellipsis" title={f.filePath}>{f.filePath}</td>
                        <td className="r mono">{f.sessionCount}</td>
                        <td className="r mono">{f.changeCount}</td>
                        <td className="r mono">{f.creates}</td>
                        <td className="r mono">{f.modifies}</td>
                        <td className="r mono">{f.deletes}</td>
                        <td>
                          <div className="churn-bar">
                            <div className="churn-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'heatmap' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Activity Heatmap (Sessions by Day & Hour)</span>
          </div>
          <div className="card-body">
            {heatmap.length === 0 ? (
              <div className="empty-state">No activity data recorded yet</div>
            ) : (
              <div className="heatmap-grid">
                <div className="heatmap-row heatmap-row--header">
                  <div className="heatmap-label" />
                  {HOURS.map(h => (
                    <div key={h} className="heatmap-hour-label">{h}</div>
                  ))}
                </div>
                {DAYS.map((day, di) => (
                  <div key={day} className="heatmap-row">
                    <div className="heatmap-label">{day}</div>
                    {HOURS.map(h => {
                      const val = heatmapGrid[`${di}-${h}`] || 0;
                      const intensity = val / maxSessions;
                      return (
                        <div
                          key={h}
                          className="heatmap-cell"
                          style={{
                            backgroundColor: val > 0
                              ? `rgba(99, 102, 241, ${0.15 + intensity * 0.85})`
                              : 'var(--bg-raised)',
                          }}
                          title={`${day} ${h}:00 — ${val} session${val !== 1 ? 's' : ''}`}
                        >
                          {val > 0 && <span className="heatmap-val">{val}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="heatmap-legend">
                  <span>Less</span>
                  {[0.15, 0.35, 0.55, 0.75, 1].map((v, i) => (
                    <div key={i} className="heatmap-legend-cell" style={{ backgroundColor: `rgba(99, 102, 241, ${v})` }} />
                  ))}
                  <span>More</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'projects' && (
        <>
          {projectChartData.length > 0 && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Cost by Project (Top 10)</span>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={projectChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="cost" name="Cost ($)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <span className="card-title">All Projects</span>
            </div>
            <div className="card-body--flush">
              {projects.length === 0 ? (
                <div className="empty-state">No project data recorded yet</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Directory</th>
                      <th className="r">Sessions</th>
                      <th className="r">Duration</th>
                      <th className="r">Files</th>
                      <th className="r">Commits</th>
                      <th className="r">Tokens</th>
                      <th className="r">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects
                      .sort((a, b) => b.totalCost - a.totalCost)
                      .map((p, i) => (
                        <tr key={i}>
                          <td className="mono ellipsis" title={p.project}>{p.project}</td>
                          <td className="r mono">{p.sessions}</td>
                          <td className="r mono">{Math.round(p.totalTime / 3600)}h</td>
                          <td className="r mono">{p.totalFiles}</td>
                          <td className="r mono">{p.totalCommits}</td>
                          <td className="r mono">{formatTokens(p.totalTokens)}</td>
                          <td className="r mono cost">{formatCost(p.totalCost)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'pricing' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Model Pricing Table</span>
          </div>
          <div className="card-body--flush">
            {Object.keys(pricing).length === 0 ? (
              <div className="empty-state">No pricing data available</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="r">Input ($/1M tokens)</th>
                    <th className="r">Output ($/1M tokens)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pricing)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([model, p]) => (
                      <tr key={model}>
                        <td className="mono">{model}</td>
                        <td className="r mono">${p.input.toFixed(4)}</td>
                        <td className="r mono">${p.output.toFixed(4)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
