import { useEffect, useState } from 'react';
import { fetchApi, postApi, deleteApi } from '../api';
import { IconDollar, IconRefreshCw } from './Icons';

type PricingData = Record<string, { input: number; output: number }>;

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
} as const;

export default function PricingConfig() {
  const [pricing, setPricing] = useState<PricingData>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  
  const [draftModel, setDraftModel] = useState('');
  const [draftInput, setDraftInput] = useState('1.00');
  const [draftOutput, setDraftOutput] = useState('2.00');

  const load = () => {
    setLoading(true);
    fetchApi<PricingData>('/api/pricing')
      .then(res => setPricing(res || {}))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftModel || !draftInput || !draftOutput) return;
    setAdding(true);
    try {
      await postApi('/api/pricing', {
        model: draftModel,
        input: parseFloat(draftInput),
        output: parseFloat(draftOutput),
      });
      setDraftModel('');
      load();
    } catch (err) {
      console.error(err);
      alert('Failed to update pricing');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (model: string) => {
    if (!window.confirm(`Delete override for ${model}? If this is a built-in model, it will revert to its default price.`)) return;
    try {
      await deleteApi(`/api/pricing/${encodeURIComponent(model)}`);
      load();
    } catch (err) {
      console.error(err);
      alert('Failed to delete pricing');
    }
  };

  const sortedModels = Object.entries(pricing).sort(([a], [b]) => a.localeCompare(b));

  if (loading && Object.keys(pricing).length === 0) {
    return <div className="page"><div className="loading">Loading pricing...</div></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Cloud Models Pricing</h1>
        <div className="page-subtitle">Configure token rates (per 1M tokens) for cloud API models. Custom models can be added here.</div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Model Pricing</div>
            <button className="sidebar-link start-fresh-btn" onClick={load} aria-label="Refresh" style={{ padding: '4px 8px' }}>
              <IconRefreshCw size={13} />
            </button>
          </div>
          <div className="card-body--flush">
            {sortedModels.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No models found.
              </div>
            ) : (
              <table className="tbl tbl--compact">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="r">Input $/1M</th>
                    <th className="r">Output $/1M</th>
                    <th className="r"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedModels.map(([model, rates]) => (
                    <tr key={model}>
                      <td className="mono ellipsis" title={model}>
                        {model}
                      </td>
                      <td className="r mono cost">${rates.input.toFixed(2)}</td>
                      <td className="r mono cost">${rates.output.toFixed(2)}</td>
                      <td className="r">
                        <button 
                          className="modal-btn modal-btn--danger" 
                          style={{ padding: '2px 6px', fontSize: '11px' }}
                          onClick={() => handleDelete(model)}
                        >
                          Reset/Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Add / Edit Model Pricing</div>
            <IconDollar size={16} />
          </div>
          <div className="card-body">
            <form onSubmit={handleAdd} style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="card-meta">Model Name</span>
                <input 
                  style={inputStyle} 
                  value={draftModel} 
                  onChange={e => setDraftModel(e.target.value)} 
                  placeholder="provider/model-name or custom-model"
                  required 
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span className="card-meta">Input Cost ($ per 1M tokens)</span>
                <input 
                  type="number"
                  step="0.0001"
                  min="0"
                  style={inputStyle} 
                  value={draftInput} 
                  onChange={e => setDraftInput(e.target.value)} 
                  required 
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span className="card-meta">Output Cost ($ per 1M tokens)</span>
                <input 
                  type="number"
                  step="0.0001"
                  min="0"
                  style={inputStyle} 
                  value={draftOutput} 
                  onChange={e => setDraftOutput(e.target.value)} 
                  required 
                />
              </label>

              <button 
                type="submit" 
                className="modal-btn modal-btn--primary" 
                disabled={adding || !draftModel || !draftInput || !draftOutput}
                style={{ marginTop: 8 }}
              >
                {adding ? 'Saving...' : 'Save Pricing'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
