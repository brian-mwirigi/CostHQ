import { useState, useEffect, useCallback, useRef } from 'react';
import { useLicense } from '../../../pro/dashboard/LicenseContext';
import UpgradePrompt from '../../../pro/dashboard/UpgradePrompt';
import { fetchApi } from '../api';
import { useInterval } from '../hooks/useInterval';
import { formatCost } from '../utils/format';

// ── Types ────────────────────────────────────────────

interface ThresholdRule {
  limit: number;
  alarm: boolean; // true = sound + notification, false = silent (visual only)
}

interface Thresholds {
  dailyCost: ThresholdRule;
  totalCost: ThresholdRule;
  sessionCost: ThresholdRule;
}

interface Alert {
  key: string;
  level: 'warning' | 'danger';
  label: string;
  message: string;
  hasAlarm: boolean;
}

interface Stats {
  totalSessions: number;
  totalAICost: number;
}

interface DailyCost {
  day: string;
  cost: number;
  sessions: number;
}

interface TopSession {
  id: number;
  name: string;
  aiCost: number;
  duration: number;
  startTime: string;
}

// ── Threshold persistence ────────────────────────────

const THRESHOLDS_KEY = 'cs-spend-thresholds';

function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate from old format (plain numbers) to new format (objects)
      if (typeof parsed.dailyCost === 'number') {
        return {
          dailyCost: { limit: parsed.dailyCost, alarm: false },
          totalCost: { limit: parsed.totalCost, alarm: false },
          sessionCost: { limit: parsed.sessionCost, alarm: false },
        };
      }
      return parsed;
    }
  } catch {}
  return {
    dailyCost: { limit: 0, alarm: false },
    totalCost: { limit: 0, alarm: false },
    sessionCost: { limit: 0, alarm: false },
  };
}

function saveThresholds(t: Thresholds) {
  localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(t));
}

// ── Alarm sound (Web Audio API) ──────────────────────

let audioCtx: AudioContext | null = null;

function playAlarmSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Two-tone alarm: high-low-high pattern
    const times = [0, 0.15, 0.3, 0.45, 0.6];
    const freqs = [880, 660, 880, 660, 880];
    const now = ctx.currentTime;

    times.forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freqs[i];
      gain.gain.setValueAtTime(0.08, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.13);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.14);
    });
  } catch {}
}

// ── Browser notification ─────────────────────────────

function sendNotification(title: string, body: string) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        new Notification(title, { body, icon: '/favicon.ico' });
      }
    });
  }
}

// ── Alert computation ────────────────────────────────

function computeAlerts(
  stats: Stats,
  daily: DailyCost[],
  top: TopSession[],
  thresholds: Thresholds,
): Alert[] {
  const alerts: Alert[] = [];

  if (thresholds.totalCost.limit > 0 && stats.totalAICost >= thresholds.totalCost.limit) {
    alerts.push({
      key: 'total',
      level: stats.totalAICost >= thresholds.totalCost.limit * 1.5 ? 'danger' : 'warning',
      label: 'Total Spend',
      message: `${formatCost(stats.totalAICost)} spent — exceeds your ${formatCost(thresholds.totalCost.limit)} limit`,
      hasAlarm: thresholds.totalCost.alarm,
    });
  }

  if (thresholds.dailyCost.limit > 0 && daily.length > 0) {
    const today = daily[daily.length - 1];
    if (today && today.cost >= thresholds.dailyCost.limit) {
      alerts.push({
        key: 'daily',
        level: today.cost >= thresholds.dailyCost.limit * 1.5 ? 'danger' : 'warning',
        label: 'Daily Spend',
        message: `${formatCost(today.cost)} today — exceeds your ${formatCost(thresholds.dailyCost.limit)}/day limit`,
        hasAlarm: thresholds.dailyCost.alarm,
      });
    }
  }

  if (thresholds.sessionCost.limit > 0 && top.length > 0) {
    const expensive = top.filter((s) => s.aiCost >= thresholds.sessionCost.limit);
    if (expensive.length > 0) {
      alerts.push({
        key: 'session',
        level: expensive.some((s) => s.aiCost >= thresholds.sessionCost.limit * 1.5) ? 'danger' : 'warning',
        label: 'Session Spend',
        message: `${expensive.length} session${expensive.length > 1 ? 's' : ''} over your ${formatCost(thresholds.sessionCost.limit)} limit`,
        hasAlarm: thresholds.sessionCost.alarm,
      });
    }
  }

  return alerts;
}

// ── Progress bar helper ──────────────────────────────

function ProgressBar({ current, limit }: { current: number; limit: number }) {
  if (limit <= 0) return null;
  const pct = Math.min((current / limit) * 100, 100);
  const color = current >= limit ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';

  return (
    <div className="alert-progress">
      <div className="alert-progress-bar">
        <div className="alert-progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="alert-progress-labels">
        <span style={{ color }}>{formatCost(current)}</span>
        <span>{formatCost(limit)}</span>
      </div>
    </div>
  );
}

// ── Alarm mode toggle ────────────────────────────────

function AlarmToggle({ alarm, onToggle }: { alarm: boolean; onToggle: () => void }) {
  return (
    <div className="alarm-toggle-row">
      <button className={`alarm-toggle-btn ${alarm ? 'alarm-toggle-btn--active' : ''}`} onClick={onToggle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {alarm ? 'Alarm on' : 'Silent'}
      </button>
      <span className="alarm-toggle-hint">
        {alarm ? 'Sound + notification when exceeded' : 'Visual alert only'}
      </span>
    </div>
  );
}

// ── Component ────────────────────────────────────────

export default function Alerts() {
  const { isPro } = useLicense();
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<DailyCost[]>([]);
  const [top, setTop] = useState<TopSession[]>([]);
  const [thresholds, setThresholds] = useState<Thresholds>(loadThresholds);
  // Track which alerts already fired sound/notification this session.
  // null = haven't done initial load yet (skip alarm on first load).
  const firedRef = useRef<Set<string> | null>(null);

  const fetchAll = useCallback(() => {
    fetchApi<Stats>('/api/stats').then(setStats);
    fetchApi<DailyCost[]>('/api/daily-costs', { days: '30' }).then(setDaily);
    fetchApi<TopSession[]>('/api/top-sessions', { limit: '20' }).then(setTop);
  }, []);

  useEffect(() => { fetchAll(); }, []);
  useInterval(fetchAll, 30_000);

  const alerts = stats ? computeAlerts(stats, daily, top, thresholds) : [];

  // Fire alarm sound + notification for new alerts that have alarm enabled.
  // On first load, we record existing alerts but don't fire alarms (they were
  // already exceeded before the user opened the page). Only NEW breaches
  // detected on subsequent poll cycles trigger alarms.
  useEffect(() => {
    if (!stats || !isPro) return; // wait for data

    if (firedRef.current === null) {
      // First load — record all current alerts as already-known, don't fire
      firedRef.current = new Set(alerts.map((a) => a.key));
      return;
    }

    for (const alert of alerts) {
      if (alert.hasAlarm && !firedRef.current.has(alert.key)) {
        firedRef.current.add(alert.key);
        playAlarmSound();
        sendNotification(`codesession — ${alert.label}`, alert.message);
      }
    }
    // Clear fired status for alerts that are no longer active
    const activeKeys = new Set(alerts.map((a) => a.key));
    for (const key of firedRef.current) {
      if (!activeKeys.has(key)) {
        firedRef.current.delete(key);
      }
    }
  }, [stats, daily, top, thresholds, alerts, isPro]);

  const updateLimit = (key: keyof Thresholds, value: string) => {
    const num = parseFloat(value) || 0;
    const updated = { ...thresholds, [key]: { ...thresholds[key], limit: num } };
    setThresholds(updated);
    saveThresholds(updated);
    // Reset fired state when threshold changes
    firedRef.current?.delete(key === 'dailyCost' ? 'daily' : key === 'totalCost' ? 'total' : 'session');
  };

  const toggleAlarm = (key: keyof Thresholds) => {
    const enabling = !thresholds[key].alarm;
    const updated = { ...thresholds, [key]: { ...thresholds[key], alarm: enabling } };
    setThresholds(updated);
    saveThresholds(updated);

    if (enabling) {
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      // Clear fired state so alarm fires if threshold is already exceeded
      const alertKey = key === 'dailyCost' ? 'daily' : key === 'totalCost' ? 'total' : 'session';
      firedRef.current?.delete(alertKey);
    }
  };

  if (!isPro) {
    return (
      <UpgradePrompt 
        feature="Alerts" 
        description="Set custom budget thresholds and receive browser and sound notifications when you exceed them."
      />
    );
  }

  const enabledCount = [thresholds.dailyCost, thresholds.totalCost, thresholds.sessionCost].filter(v => v.limit > 0).length;
  const alarmCount = [thresholds.dailyCost, thresholds.totalCost, thresholds.sessionCost].filter(v => v.limit > 0 && v.alarm).length;
  const todayCost = daily.length > 0 ? daily[daily.length - 1].cost : 0;
  const topSessionCost = top.length > 0 ? Math.max(...top.map(s => s.aiCost)) : 0;

  return (
    <div className="page">
      {/* Header with status */}
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">Alerts</h1>
            <div className="page-subtitle">Monitor spend and get warned when thresholds are exceeded</div>
          </div>
          <div className="alert-status-badges">
            <span className={`alert-status-badge ${enabledCount > 0 ? 'alert-status-badge--on' : 'alert-status-badge--off'}`}>
              {enabledCount > 0 ? `${enabledCount} rule${enabledCount > 1 ? 's' : ''} active` : 'No rules set'}
            </span>
            {alarmCount > 0 && (
              <span className="alert-status-badge alert-status-badge--alarm">
                {alarmCount} with alarm
              </span>
            )}
            {alerts.length > 0 && (
              <span className="alert-status-badge alert-status-badge--triggered">
                {alerts.length} triggered
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Fired alerts */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {alerts.map((alert) => (
            <div key={alert.key} className={`alert-banner alert-banner--${alert.level}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="alert-banner-icon">{alert.level === 'danger' ? '!!' : '!'}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {alert.label}
                    {alert.hasAlarm && <span className="alert-alarm-badge">ALARM</span>}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>{alert.message}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Threshold cards */}
      <div className="alert-rules">

        {/* Daily spend */}
        <div className={`card alert-rule-card ${thresholds.dailyCost.limit > 0 ? 'alert-rule-card--enabled' : ''}`}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`alert-dot ${thresholds.dailyCost.limit > 0 ? (todayCost >= thresholds.dailyCost.limit ? 'alert-dot--danger' : 'alert-dot--ok') : 'alert-dot--off'}`} />
              <div className="card-title">Daily Spend Limit</div>
            </div>
            <span className={`alert-rule-status ${thresholds.dailyCost.limit > 0 ? 'alert-rule-status--on' : ''}`}>
              {thresholds.dailyCost.limit > 0 ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="card-body">
            <div className="alert-rule-row">
              <label>Limit</label>
              <div className="threshold-input">
                <span>$</span>
                <input
                  type="number" min="0" step="0.5"
                  value={thresholds.dailyCost.limit || ''}
                  placeholder="disabled"
                  onChange={(e) => updateLimit('dailyCost', e.target.value)}
                />
              </div>
            </div>
            {thresholds.dailyCost.limit > 0 && (
              <>
                <AlarmToggle alarm={thresholds.dailyCost.alarm} onToggle={() => toggleAlarm('dailyCost')} />
                <ProgressBar current={todayCost} limit={thresholds.dailyCost.limit} />
                <div className="alert-rule-meta">
                  {todayCost >= thresholds.dailyCost.limit
                    ? `Exceeded by ${formatCost(todayCost - thresholds.dailyCost.limit)}`
                    : `${formatCost(thresholds.dailyCost.limit - todayCost)} remaining today`}
                </div>
              </>
            )}
            {thresholds.dailyCost.limit === 0 && (
              <div className="alert-rule-hint">Set a dollar amount to get warned when your daily spend exceeds it.</div>
            )}
          </div>
        </div>

        {/* Total spend */}
        <div className={`card alert-rule-card ${thresholds.totalCost.limit > 0 ? 'alert-rule-card--enabled' : ''}`}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`alert-dot ${thresholds.totalCost.limit > 0 ? ((stats?.totalAICost ?? 0) >= thresholds.totalCost.limit ? 'alert-dot--danger' : 'alert-dot--ok') : 'alert-dot--off'}`} />
              <div className="card-title">Total Spend Limit</div>
            </div>
            <span className={`alert-rule-status ${thresholds.totalCost.limit > 0 ? 'alert-rule-status--on' : ''}`}>
              {thresholds.totalCost.limit > 0 ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="card-body">
            <div className="alert-rule-row">
              <label>Limit</label>
              <div className="threshold-input">
                <span>$</span>
                <input
                  type="number" min="0" step="1"
                  value={thresholds.totalCost.limit || ''}
                  placeholder="disabled"
                  onChange={(e) => updateLimit('totalCost', e.target.value)}
                />
              </div>
            </div>
            {thresholds.totalCost.limit > 0 && (
              <>
                <AlarmToggle alarm={thresholds.totalCost.alarm} onToggle={() => toggleAlarm('totalCost')} />
                {stats && <ProgressBar current={stats.totalAICost} limit={thresholds.totalCost.limit} />}
                {stats && (
                  <div className="alert-rule-meta">
                    {stats.totalAICost >= thresholds.totalCost.limit
                      ? `Exceeded by ${formatCost(stats.totalAICost - thresholds.totalCost.limit)}`
                      : `${formatCost(thresholds.totalCost.limit - stats.totalAICost)} remaining`}
                  </div>
                )}
              </>
            )}
            {thresholds.totalCost.limit === 0 && (
              <div className="alert-rule-hint">Set a budget cap across all sessions. You'll be warned when your cumulative spend hits this.</div>
            )}
          </div>
        </div>

        {/* Per-session spend */}
        <div className={`card alert-rule-card ${thresholds.sessionCost.limit > 0 ? 'alert-rule-card--enabled' : ''}`}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`alert-dot ${thresholds.sessionCost.limit > 0 ? (topSessionCost >= thresholds.sessionCost.limit ? 'alert-dot--danger' : 'alert-dot--ok') : 'alert-dot--off'}`} />
              <div className="card-title">Per-Session Limit</div>
            </div>
            <span className={`alert-rule-status ${thresholds.sessionCost.limit > 0 ? 'alert-rule-status--on' : ''}`}>
              {thresholds.sessionCost.limit > 0 ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="card-body">
            <div className="alert-rule-row">
              <label>Limit</label>
              <div className="threshold-input">
                <span>$</span>
                <input
                  type="number" min="0" step="0.5"
                  value={thresholds.sessionCost.limit || ''}
                  placeholder="disabled"
                  onChange={(e) => updateLimit('sessionCost', e.target.value)}
                />
              </div>
            </div>
            {thresholds.sessionCost.limit > 0 && (
              <>
                <AlarmToggle alarm={thresholds.sessionCost.alarm} onToggle={() => toggleAlarm('sessionCost')} />
                {top.length > 0 && <ProgressBar current={topSessionCost} limit={thresholds.sessionCost.limit} />}
                {top.length > 0 && (
                  <div className="alert-rule-meta">
                    {(() => {
                      const overCount = top.filter(s => s.aiCost >= thresholds.sessionCost.limit).length;
                      return overCount > 0
                        ? `${overCount} session${overCount > 1 ? 's' : ''} over limit`
                        : 'All sessions within limit';
                    })()}
                  </div>
                )}
              </>
            )}
            {thresholds.sessionCost.limit === 0 && (
              <div className="alert-rule-hint">Flag any single session that costs more than this amount.</div>
            )}
          </div>
        </div>
      </div>

      {/* Sessions over limit table */}
      {thresholds.sessionCost.limit > 0 && top.filter((s) => s.aiCost >= thresholds.sessionCost.limit).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div className="card-title">Sessions Over Limit</div>
            <div className="card-meta">{top.filter(s => s.aiCost >= thresholds.sessionCost.limit).length} found</div>
          </div>
          <div className="card-body--flush">
            <table className="tbl tbl--compact">
              <thead>
                <tr><th>Session</th><th className="r">Cost</th><th className="r">Over By</th></tr>
              </thead>
              <tbody>
                {top
                  .filter((s) => s.aiCost >= thresholds.sessionCost.limit)
                  .map((s) => (
                    <tr key={s.id}>
                      <td className="ellipsis" title={s.name}>{s.name || `Session #${s.id}`}</td>
                      <td className="r mono cost">{formatCost(s.aiCost)}</td>
                      <td className="r mono" style={{ color: 'var(--danger)' }}>+{formatCost(s.aiCost - thresholds.sessionCost.limit)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info footer */}
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 16 }}>
        Thresholds are stored in your browser's local storage. Alarm mode uses browser notifications and Web Audio — make sure to allow notifications when prompted.
      </div>
    </div>
  );
}
