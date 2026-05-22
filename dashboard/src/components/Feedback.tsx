import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../api';

interface FeedbackItem {
  id: number;
  type: string;
  message: string;
  email?: string;
  timestamp: string;
}

const FEEDBACK_TYPES = ['Feature Request', 'Bug Report', 'General Feedback', 'Question'] as const;

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-raised)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 'var(--radius)',
  fontFamily: 'var(--font-sans)',
  padding: '10px 12px',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

export default function Feedback() {
  const [feedbackType, setFeedbackType] = useState<string>(FEEDBACK_TYPES[0]);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<FeedbackItem[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const items = await fetchApi<FeedbackItem[]>('/api/feedback');
      setHistory(items);
    } catch {
      // silently ignore – history is non-critical
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      setSuccess(false);
      setMessage('');
      setEmail('');
      setFeedbackType(FEEDBACK_TYPES[0]);
    }, 3000);
    return () => clearTimeout(timer);
  }, [success]);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Feedback</h1>
        <p className="page-subtitle">Help improve codesession by sharing your thoughts</p>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Send Feedback</span>
        </div>
        <div className="card-body">
          {success ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <p style={{ marginTop: 12, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                Thank you!
              </p>
              <p style={{ marginTop: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                Your feedback has been submitted.
              </p>
            </div>
          ) : (
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!message.trim()) return;

              // 1. Silently save history locally
              const token = document.querySelector('meta[name="cs-token"]')?.getAttribute('content') || (window as any).__CS_TOKEN || null;
              const headers: Record<string, string> = { 'Content-Type': 'application/json' };
              if (token) headers['Authorization'] = `Bearer ${token}`;
              await fetch('/api/v1/feedback', {
                method: 'POST',
                headers,
                body: JSON.stringify({ type: feedbackType, message, email: email || undefined }),
              }).catch(() => {});

              // 2. Open email client via mailto:
              const subject = encodeURIComponent(`Codesession Feedback: ${feedbackType}`);
              let bodyText = `Type: ${feedbackType}\n`;
              if (email) bodyText += `From: ${email}\n`;
              bodyText += `\nMessage:\n${message}\n`;
              const body = encodeURIComponent(bodyText);
              
              window.location.href = `mailto:brianinesh@gmail.com?subject=${subject}&body=${body}`;
              
              setMessage('');
              setSuccess(true);
              loadHistory();
            }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Type
                </label>
                <select
                  value={feedbackType}
                  onChange={(e) => setFeedbackType(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  {FEEDBACK_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Message
                </label>
                <textarea
                  name="Message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What would make codesession better for you?"
                  rows={5}
                  required
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Email (optional)
                </label>
                <input
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com (optional)"
                  style={inputStyle}
                />
              </div>

              {error && (
                <p style={{ margin: 0, fontSize: 13, color: '#f85149' }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={!message.trim()}
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 20px',
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: !message.trim() ? 'not-allowed' : 'pointer',
                  opacity: !message.trim() ? 0.5 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                Submit via Email Client
              </button>
            </form>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <span className="card-title">Previous Feedback</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {history.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: 'var(--accent)',
                    }}
                  >
                    {item.type}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {new Date(item.timestamp).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {item.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
