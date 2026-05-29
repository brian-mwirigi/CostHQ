import { useState } from 'react';
import { IconClock, IconDollar, IconFile, IconGitCommit, IconActivity } from './Icons';

const steps = [
  {
    title: 'Welcome to CostHQ',
    content: (
      <div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 20px' }}>
          <strong style={{ color: 'var(--text-primary)' }}>CostHQ</strong> is your personal dashboard for tracking AI-assisted coding sessions.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { icon: <IconClock size={16} />, text: 'Track session duration and activity' },
            { icon: <IconDollar size={16} />, text: 'Monitor AI costs across models and providers' },
            { icon: <IconFile size={16} />, text: 'Log file changes and diffs automatically' },
            { icon: <IconGitCommit size={16} />, text: 'Link sessions to git commits' },
          ].map((item) => (
            <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-primary)', display: 'flex' }}>{item.icon}</span>
              {item.text}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: 'Quick Start',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          Three commands are all you need to manage your sessions:
        </p>
        {[
          { cmd: 'cs start', desc: 'Begin a new coding session' },
          { cmd: 'cs log-ai', desc: 'Log AI usage, model, tokens & cost' },
          { cmd: 'cs end', desc: 'End the session and save a summary' },
        ].map((item) => (
          <div
            key={item.cmd}
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-primary)',
                fontWeight: 600,
                flexShrink: 0,
                minWidth: 80,
              }}
            >
              {item.cmd}
            </code>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.desc}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Dashboard Navigation',
    content: (
      <div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Your data is organized into five main views:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { label: 'Overview', desc: 'At-a-glance stats — total spend, sessions, active time' },
            { label: 'Sessions', desc: 'Browse and drill into individual coding sessions' },
            { label: 'Models', desc: 'Cost and usage breakdown by AI model' },
            { label: 'Insights', desc: 'Trends, charts, and productivity patterns' },
            { label: 'Alerts', desc: 'Set spend thresholds and get notified' },
          ].map((item) => (
            <div key={item.label} style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  minWidth: 70,
                  flexShrink: 0,
                }}
              >
                {item.label}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {item.desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "You're all set",
    content: (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ color: 'var(--text-primary)', marginBottom: 24, display: 'flex', justifyContent: 'center' }}>
          <IconActivity size={48} />
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
          Start a session from your terminal with <code style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>cs start</code>,
          track your AI usage, and come back here to see your data populate.
        </p>
      </div>
    ),
  },
];

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [telemetry, setTelemetry] = useState(true);
  const isLast = step === steps.length - 1;

  const handleComplete = () => {
    if (telemetry) {
      localStorage.setItem('cs-telemetry', '1');
    } else {
      localStorage.removeItem('cs-telemetry');
    }
    onComplete();
  };

  const currentStep = steps[step];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onComplete}
    >
      <div
        style={{
          position: 'relative',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          maxWidth: 480,
          width: '90vw',
          padding: 32,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleComplete}
          style={{
            position: 'absolute',
            top: 16,
            right: 20,
            background: 'none',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-tertiary)'; }}
        >
          Skip
        </button>

        <div style={{ minHeight: 280 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: '0 0 24px',
              letterSpacing: '-0.01em'
            }}
          >
            {currentStep.title}
          </h2>
          
          {currentStep.content}


        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 32,
            paddingTop: 24,
            borderTop: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {steps.map((_, i) => (
              <div
                key={i}
                style={{
                  width: 24,
                  height: 2,
                  borderRadius: 1,
                  background: i === step ? 'var(--text-primary)' : 'var(--border)',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  padding: '6px 16px',
                  borderRadius: 'var(--radius)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.borderColor = 'var(--text-secondary)';
                  (e.target as HTMLElement).style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.borderColor = 'var(--border)';
                  (e.target as HTMLElement).style.color = 'var(--text-secondary)';
                }}
              >
                Back
              </button>
            )}

            <button
              onClick={isLast ? handleComplete : () => setStep((s) => s + 1)}
              style={{
                background: 'var(--text-primary)',
                border: '1px solid var(--text-primary)',
                color: 'var(--bg-root)',
                padding: '6px 16px',
                borderRadius: 'var(--radius)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '0.9'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
            >
              {isLast ? "Done" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
