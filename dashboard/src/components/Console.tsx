import React, { useState } from 'react';
import { IconActivity, IconCircleDot, IconZap } from './Icons';

export default function Console() {
  const [sessionName, setSessionName] = useState('');
  const [directory, setDirectory] = useState('C:\\\\');
  
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-3-5-sonnet');
  const [tokens, setTokens] = useState('');
  
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3500);
  };

  const getHeaders = () => {
    const token = document.querySelector('meta[name="cs-token"]')?.getAttribute('content') || (window as any).__CS_TOKEN || null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading('start');
    try {
      const res = await fetch('/api/v1/console/start', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name: sessionName, directory })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showMessage(`Session "${sessionName}" is now active!`, 'success');
      setSessionName('');
    } catch (err: any) {
      showMessage(err.message, 'error');
    } finally {
      setLoading(null);
    }
  };

  const handleLogAI = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading('log');
    try {
      const res = await fetch('/api/v1/console/log-ai', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ 
          provider, 
          model, 
          tokens: parseInt(tokens, 10) || 0,
          agent: 'Dashboard Console'
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showMessage(`⚡ Intercepted ${tokens} tokens instantly.`, 'success');
      setTokens('');
    } catch (err: any) {
      showMessage(err.message, 'error');
    } finally {
      setLoading(null);
    }
  };

  const handleEnd = async () => {
    setLoading('end');
    try {
      const res = await fetch('/api/v1/console/end', { 
        method: 'POST',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showMessage('Session safely terminated and saved.', 'success');
    } catch (err: any) {
      showMessage(err.message, 'error');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="overview animate-fade-in" style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
      <header style={{ marginBottom: '40px', position: 'relative' }}>
        <div style={{ position: 'absolute', top: -50, left: -50, width: '200px', height: '200px', background: 'var(--accent)', filter: 'blur(100px)', opacity: 0.15, borderRadius: '50%', zIndex: 0 }} />
        <h1 style={{ fontSize: '2.5rem', fontWeight: 800, background: 'linear-gradient(90deg, #fff, #a1a1aa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.03em', zIndex: 1, position: 'relative', margin: 0 }}>
          Command Center
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', marginTop: '8px', zIndex: 1, position: 'relative' }}>
          Real-time CLI execution with zero-latency synchronization.
        </p>
      </header>

      {message && (
        <div style={{
          marginBottom: '30px', padding: '16px 20px', borderRadius: '12px',
          background: message.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
          border: `1px solid ${message.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
          color: message.type === 'error' ? '#ef4444' : '#10b981',
          display: 'flex', alignItems: 'center', gap: '10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)', backdropFilter: 'blur(10px)',
          animation: 'slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}>
          <span style={{ fontSize: '1.2rem' }}>{message.type === 'success' ? '✓' : '⚠️'}</span>
          <span style={{ fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <style>{`
        @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .glass-card {
          background: rgba(24, 24, 27, 0.4);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 24px;
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }
        .glass-card:hover {
          border-color: rgba(255, 255, 255, 0.1);
          transform: translateY(-2px);
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .glass-card::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
          opacity: 0; transition: opacity 0.3s ease;
        }
        .glass-card:hover::before { opacity: 1; }
        
        .premium-input {
          width: 100%; padding: 12px 16px; border-radius: 10px;
          background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08);
          color: white; font-size: 0.95rem; transition: all 0.2s ease;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
        }
        .premium-input:focus {
          outline: none; border-color: var(--accent);
          background: rgba(0,0,0,0.3);
          box-shadow: 0 0 0 3px var(--accent-muted), inset 0 2px 4px rgba(0,0,0,0.1);
        }
        .premium-label {
          display: block; margin-bottom: 8px; color: var(--text-secondary);
          font-size: 0.85rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;
        }
        
        .btn-gradient {
          background: linear-gradient(135deg, var(--accent), #6366f1);
          color: white; padding: 14px; border-radius: 10px; border: none;
          font-weight: 600; cursor: pointer; transition: all 0.2s ease;
          box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
          display: flex; justify-content: center; align-items: center; gap: 8px;
        }
        .btn-gradient:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
          filter: brightness(1.1);
        }
        .btn-gradient:disabled { opacity: 0.7; cursor: not-allowed; }
        
        .btn-outline {
          background: rgba(255,255,255,0.03); color: white;
          padding: 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
          font-weight: 600; cursor: pointer; transition: all 0.2s ease;
        }
        .btn-outline:hover:not(:disabled) {
          background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2);
        }
        
        .btn-danger {
          background: rgba(239, 68, 68, 0.1); color: #ef4444;
          padding: 14px; border-radius: 10px; border: 1px solid rgba(239, 68, 68, 0.2);
          font-weight: 600; cursor: pointer; transition: all 0.2s ease;
        }
        .btn-danger:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3);
          box-shadow: 0 4px 15px rgba(239, 68, 68, 0.2);
        }
        
        .grid-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 900px) { .grid-layout { grid-template-columns: 1fr; } }
      `}</style>

      <div className="grid-layout">
        <div className="glass-card" style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.15)', padding: '8px', borderRadius: '8px', color: 'var(--accent)' }}><IconActivity size={18} /></div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Start New Session</h3>
          </div>
          <form onSubmit={handleStart} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 300px' }}>
                <label className="premium-label">Session Name</label>
                <input type="text" className="premium-input" value={sessionName} onChange={(e) => setSessionName(e.target.value)} required placeholder="e.g. Refactoring Authentication" />
              </div>
              <div style={{ flex: '1 1 300px' }}>
                <label className="premium-label">Working Directory</label>
                <input type="text" className="premium-input" value={directory} onChange={(e) => setDirectory(e.target.value)} required placeholder="C:\Projects\MyProject" />
              </div>
            </div>
            <button type="submit" className="btn-gradient" disabled={loading !== null}>
              {loading === 'start' ? 'Initializing Watchers...' : 'Boot Engine'}
            </button>
          </form>
        </div>

        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ background: 'rgba(16, 185, 129, 0.15)', padding: '8px', borderRadius: '8px', color: '#10b981' }}><IconZap size={18} /></div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Manual Token Injection</h3>
          </div>
          <form onSubmit={handleLogAI} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', gap: '15px' }}>
              <div style={{ flex: 1 }}>
                <label className="premium-label">Provider</label>
                <select className="premium-input" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="premium-label">Model</label>
                <input type="text" className="premium-input" value={model} onChange={(e) => setModel(e.target.value)} required placeholder="claude-3-5-sonnet" />
              </div>
            </div>
            <div>
              <label className="premium-label">Total Token Volume</label>
              <input type="number" className="premium-input" value={tokens} onChange={(e) => setTokens(e.target.value)} required placeholder="e.g. 15000" />
            </div>
            <button type="submit" className="btn-outline" disabled={loading !== null} style={{ marginTop: '4px' }}>
              {loading === 'log' ? 'Syncing...' : 'Inject Cost Data'}
            </button>
          </form>
        </div>

        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', padding: '8px', borderRadius: '8px', color: '#ef4444' }}><IconCircleDot size={18} /></div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Terminate Session</h3>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'auto', fontSize: '0.95rem', lineHeight: 1.6 }}>
            Safely unmounts all background listeners, flushes git commit hashes, and finalizes the timeline database for the active workspace.
          </p>
          <button onClick={handleEnd} className="btn-danger" disabled={loading !== null} style={{ marginTop: '24px' }}>
            {loading === 'end' ? 'Halting Daemons...' : 'Graceful Shutdown'}
          </button>
        </div>
      </div>
    </div>
  );
}
