import { useState } from 'react';
import { useLicense } from './LicenseContext';

const UPGRADE_URL = 'https://codesession-cli.lemonsqueezy.com';

interface Props {
  feature: string;
  description: string;
}

export default function UpgradePrompt({ feature, description }: Props) {
  const { activate } = useLicense();
  const [showInput, setShowInput] = useState(false);
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
      setLoading(false);
    }
  };

  return (
    <div className="upgrade-prompt page">
      <div className="upgrade-prompt__content card">
        <h2 className="upgrade-prompt__title">{feature} is a Pro feature</h2>
        <p className="upgrade-prompt__desc">{description}</p>
        
        <div className="upgrade-prompt__actions">
          <a href={UPGRADE_URL} target="_blank" rel="noreferrer" className="modal-btn modal-btn--primary upgrade-prompt__cta">
            Upgrade to Pro
          </a>
        </div>

        {!showInput ? (
          <button className="upgrade-prompt__link" onClick={() => setShowInput(true)}>
            Already have a license key?
          </button>
        ) : (
          <div className="upgrade-prompt__activate">
            <input 
              type="text" 
              className="license-input" 
              placeholder="CS-PRO-..." 
              value={key}
              onChange={e => setKey(e.target.value)}
              disabled={loading}
            />
            <button className="modal-btn modal-btn--primary" onClick={handleActivate} disabled={loading || !key}>
              {loading ? 'Verifying...' : 'Activate'}
            </button>
            {error && <p className="upgrade-prompt__error" style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
