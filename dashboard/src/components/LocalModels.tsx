import { useEffect, useState } from 'react';
import { fetchApi, postApi, deleteApi } from '../api';
import { IconModels, IconRefreshCw } from './Icons';
import { formatCost } from '../utils/format';

interface LocalModel {
  provider: string;
  model: string;
  costPerHour: number;
  gpuName?: string;
  notes?: string;
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
} as const;

export default function LocalModels() {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  
  const [draftProvider, setDraftProvider] = useState('ollama');
  const [draftModel, setDraftModel] = useState('');
  const [draftCost, setDraftCost] = useState('0.50');
  const [draftGpu, setDraftGpu] = useState('');

  const load = () => {
    setLoading(true);
    fetchApi<LocalModel[]>('/api/local-models')
      .then(res => setModels(res || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftModel || !draftCost) return;
    setAdding(true);
    try {
      await postApi('/api/local-models', {
        provider: draftProvider,
        model: draftModel,
        costPerHour: parseFloat(draftCost),
        gpuName: draftGpu || undefined,
      });
      setDraftModel('');
      setDraftGpu('');
      load();
    } catch (err) {
      console.error(err);
      alert('Failed to add local model');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (provider: string, model: string) => {
    if (!window.confirm(`Remove ${provider}/${model}?`)) return;
    try {
      await deleteApi(`/api/local-models/${encodeURIComponent(provider)}/${encodeURIComponent(model)}`);
      load();
    } catch (err) {
      console.error(err);
      alert('Failed to remove model');
    }
  };

  if (loading && models.length === 0) {
    return <div className="page"><div className="loading">Loading local models...</div></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Local Models</h1>
        <div className="page-subtitle">Track compute costs for Ollama, vLLM, and llama.cpp by registering an hourly GPU rate.</div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Registered Models</div>
            <button className="sidebar-link start-fresh-btn" onClick={load} aria-label="Refresh" style={{ padding: '4px 8px' }}>
              <IconRefreshCw size={13} />
            </button>
          </div>
          <div className="card-body--flush">
            {models.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No local models registered.
              </div>
            ) : (
              <table className="tbl tbl--compact">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="r">$/hr</th>
                    <th>GPU</th>
                    <th className="r"></th>
                  </tr>
                </thead>
                <tbody>
                  {models.map(m => (
                    <tr key={`${m.provider}/${m.model}`}>
                      <td className="mono ellipsis" title={`${m.provider}/${m.model}`}>
                        <span style={{ color: 'var(--text-muted)' }}>{m.provider}/</span>{m.model}
                      </td>
                      <td className="r mono cost">{formatCost(m.costPerHour)}</td>
                      <td className="mono ellipsis" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{m.gpuName || '-'}</td>
                      <td className="r">
                        <button 
                          className="modal-btn modal-btn--danger" 
                          style={{ padding: '2px 6px', fontSize: '11px' }}
                          onClick={() => handleDelete(m.provider, m.model)}
                        >
                          Delete
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
            <div className="card-title">Add Local Model</div>
            <IconModels size={16} />
          </div>
          <div className="card-body">
            <form onSubmit={handleAdd} style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="card-meta">Provider</span>
                <select 
                  style={inputStyle} 
                  value={draftProvider} 
                  onChange={e => setDraftProvider(e.target.value)}
                >
                  <option value="ollama">ollama</option>
                  <option value="llamacpp">llamacpp</option>
                  <option value="vllm">vllm</option>
                  <option value="lmstudio">lmstudio</option>
                  <option value="custom">custom</option>
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span className="card-meta">Model Name</span>
                <input 
                  style={inputStyle} 
                  value={draftModel} 
                  onChange={e => setDraftModel(e.target.value)} 
                  placeholder="llama3, mixtral, etc."
                  required 
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span className="card-meta">Cost per Hour ($)</span>
                <input 
                  type="number"
                  step="0.01"
                  min="0"
                  style={inputStyle} 
                  value={draftCost} 
                  onChange={e => setDraftCost(e.target.value)} 
                  placeholder="0.50"
                  required 
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span className="card-meta">GPU Name (optional)</span>
                <input 
                  style={inputStyle} 
                  value={draftGpu} 
                  onChange={e => setDraftGpu(e.target.value)} 
                  placeholder="RTX 4090, A100, etc."
                />
              </label>

              <button 
                type="submit" 
                className="modal-btn modal-btn--primary" 
                disabled={adding || !draftModel || !draftCost}
                style={{ marginTop: 8 }}
              >
                {adding ? 'Adding...' : 'Register Model'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
