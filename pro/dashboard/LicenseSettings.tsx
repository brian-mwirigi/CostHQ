import { useState } from 'react';
import { useLicense } from './LicenseContext';

const UPGRADE_URL = 'https://codesession.dev/pro';

export default function LicenseSettings() {
  const { valid, plan, email, seats, trial, activate, deactivate } = useLicense();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async () => {
    if (!key.trim()) return;
    setLoading(true);
    setError(null);
    const res = await activate(key.trim());
    if (!res.success) {
      setError(res.error || 'Activation failed');
    }
    setLoading(false);
  };

  const handleDeactivate = async () => {
    if (window.confirm('Are you sure you want to remove your license from this machine?')) {
      await deactivate();
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">License & Upgrade</h1>
        <p className="page-subtitle">Manage your codesession license and support development.</p>
      </header>

      <div className="license-card card">
        <div className="card-header">
          <h2 className="card-title">Current Plan: <span className="plan-name" style={{ textTransform: 'capitalize' }}>{plan}</span></h2>
        </div>
        <div className="card-body">
          {valid && plan !== 'free' ? (
            <div className="license-active">
              <p>Your {plan === 'enterprise' ? 'Enterprise' : 'Pro'} license is active.</p>
              <ul className="license-details">
                <li><strong>Email:</strong> {email}</li>
                <li><strong>Type:</strong> Lifetime</li>
                {plan === 'enterprise' && <li><strong>Seats:</strong> {seats}</li>}
              </ul>
              <button className="modal-btn modal-btn--danger" onClick={handleDeactivate}>Deactivate License</button>
            </div>
          ) : (
            <div className="license-inactive">
              {trial.active && (
                <div className="license-trial">
                  <p><strong>14-Day Pro Trial Active</strong></p>
                  <p>{trial.daysRemaining} days remaining. All Pro features are unlocked.</p>
                </div>
              )}
              <div className="license-activate-form">
                <p>Have a license key?</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input 
                    type="text" 
                    className="license-input" 
                    placeholder="CS-PRO-..." 
                    value={key}
                    onChange={e => setKey(e.target.value)}
                    disabled={loading}
                    style={{ flex: 1 }}
                  />
                  <button className="modal-btn modal-btn--primary" onClick={handleActivate} disabled={loading || !key}>
                    {loading ? 'Verifying...' : 'Activate'}
                  </button>
                </div>
                {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {!valid && (
        <div className="license-tiers">
          <div className="tier-card">
            <h3>Free</h3>
            <p className="tier-price">$0</p>
            <ul>
              <li>All CLI commands</li>
              <li>Unlimited tracking</li>
              <li>Basic dashboard</li>
            </ul>
          </div>
          <div className="tier-card tier-card--recommended">
            <h3>Pro</h3>
            <p className="tier-price">$29 <span>lifetime</span></p>
            <ul>
              <li>Advanced analytics (Insights)</li>
              <li>Budget alerts & notifications</li>
              <li>Shareable stat cards</li>
              <li>Claude Code auto-logging</li>
            </ul>
            <a href={UPGRADE_URL} target="_blank" rel="noreferrer" className="modal-btn modal-btn--primary">Get Pro</a>
          </div>
          <div className="tier-card">
            <h3>Enterprise</h3>
            <p className="tier-price">$19 <span>/ seat (lifetime)</span></p>
            <ul>
              <li>Everything in Pro</li>
              <li>Volume discount (min 5)</li>
              <li>Team management</li>
              <li>Priority support</li>
            </ul>
            <a href={UPGRADE_URL} target="_blank" rel="noreferrer" className="modal-btn">Contact Us</a>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h2 className="card-title">Love codesession but don't need Pro?</h2>
        </div>
        <div className="card-body">
          <p>codesession is built by an independent developer. If the Free tier saves you time and money, consider saying thanks!</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <a href="https://github.com/sponsors/brian-mwirigi" target="_blank" rel="noreferrer" className="modal-btn">
              GitHub Sponsors
            </a>
            <a href="https://buymeacoffee.com/brianmwirigi" target="_blank" rel="noreferrer" className="modal-btn">
              Buy me a coffee
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
