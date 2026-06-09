import { useState, useEffect } from 'react';
import type { Page } from '../App';
import { fetchApi, postApi } from '../api';
import { IconOverview, IconSessions, IconModels, IconActivity, IconBarChart, IconBell, IconKey, IconRefreshCw, IconDownload, IconMessageSquare, IconHeart, IconTarget, IconDollar } from './Icons';
import ProBadge from '../../../pro/dashboard/ProBadge';
import { useLicense } from '../../../pro/dashboard/LicenseContext';

const NAV: { page: Page; icon: React.ReactNode; label: string }[] = [
  { page: 'overview', icon: <IconOverview size={16} />, label: 'Overview' },
  { page: 'sessions', icon: <IconSessions size={16} />, label: 'Sessions' },
  { page: 'models', icon: <IconModels size={16} />, label: 'Models' },
  { page: 'local-models', icon: <IconModels size={16} />, label: 'Local Models' },
  { page: 'pricing', icon: <IconDollar size={16} />, label: 'Cloud Pricing' },
  { page: 'insights', icon: <IconBarChart size={16} />, label: 'Insights' },
  { page: 'alerts', icon: <IconBell size={16} />, label: 'Alerts' },
  { page: 'pro', icon: <IconTarget size={16} />, label: 'Pro Ops' },
  { page: 'audit', icon: <IconTarget size={16} />, label: 'Compliance' },
  { page: 'share', icon: <IconDownload size={16} />, label: 'Share Stats' },
  { page: 'console', icon: <IconActivity size={16} />, label: 'Console' },
  { page: 'feedback', icon: <IconMessageSquare size={16} />, label: 'Feedback' },
  { page: 'upgrade', icon: <IconKey size={16} />, label: 'License' },
  { page: 'donate', icon: <IconHeart size={16} />, label: 'Donate' },
];

interface Props {
  page: Page;

  onNavigate: (p: Page) => void;
}

export default function Sidebar({ page, onNavigate }: Props) {
  const { valid, plan, seats, trial } = useLicense();
  const [version, setVersion] = useState('...');
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetchApi<{ version: string }>('/api/version').then(d => setVersion(d.version)).catch(() => {});
  }, []);

  const handleReset = async () => {
    if (!window.confirm('Are you absolutely sure you want to completely erase all data? This cannot be undone.')) return;
    
    setResetting(true);
    try {
      await postApi('/api/reset', undefined, { 'X-Confirm-Reset': 'yes' });
      // Clear alert thresholds from localStorage too
      localStorage.removeItem('cs-spend-thresholds');
      setShowReset(false);
      window.location.reload();
    } catch {
      setResetting(false);
    }
  };

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon"><IconActivity size={18} /></span>
          <span className="brand-text">CostHQ</span>
        </div>

        <nav className="sidebar-nav" role="navigation" aria-label="Main Navigation">
          {NAV.map((n) => (
            <button
              key={n.page}
              className={`nav-item${page === n.page ? ' active' : ''}`}
              onClick={() => onNavigate(n.page)}
              aria-label={n.label}
            >
              <span className="nav-icon" aria-hidden="true">{n.icon}</span>
              <span>{n.label}</span>
              {['insights', 'alerts', 'share', 'pro', 'audit'].includes(n.page) && <ProBadge />}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-link start-fresh-btn" onClick={() => setShowReset(true)} aria-label="Start Fresh">
            <IconRefreshCw size={13} aria-hidden="true" />
            {' '}Start Fresh
          </button>
          <div className="sidebar-footer-row">
            <a href="https://github.com/brian-mwirigi/CostHQ" target="_blank" rel="noreferrer" className="sidebar-link star-cta" aria-label="Star on GitHub">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/></svg>
              {' '}Star on GitHub
            </a>
            <span className="sidebar-version">v{version}</span>
          </div>
          <div style={{ marginTop: 12, padding: '0 12px', fontSize: 11, color: 'var(--text-muted)' }}>
            Plan: <span style={{ textTransform: 'capitalize' }}>{valid ? (plan === 'enterprise' ? `Enterprise (${seats} seats)` : 'Pro') : 'Free'}</span>
            {!valid && trial.active && <span style={{ display: 'block', color: 'var(--warning)', marginTop: 2 }}>Pro Trial: {trial.daysRemaining} days left</span>}
          </div>
        </div>
      </aside>

      {/* Reset confirmation modal */}
      {showReset && (
        <div className="modal-overlay" onClick={() => !resetting && setShowReset(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <IconRefreshCw size={20} />
              <h2>Start Fresh</h2>
            </div>
            <div className="modal-body">
              <p>This will permanently delete <strong>all session data</strong> including:</p>
              <ul>
                <li>All tracked sessions and their history</li>
                <li>AI usage and cost records</li>
                <li>File change logs and commit history</li>
                <li>Alert threshold settings</li>
              </ul>
              <p className="modal-warn">This action cannot be undone.</p>
            </div>
            <div className="modal-actions">
              <button className="modal-btn modal-btn--cancel" onClick={() => setShowReset(false)} disabled={resetting}>
                Cancel
              </button>
              <button className="modal-btn modal-btn--danger" onClick={handleReset} disabled={resetting}>
                {resetting ? 'Clearing...' : 'Clear All Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
