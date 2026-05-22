import { useState, useEffect } from 'react';
import { IconZap } from './Icons';

export default function Banner() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem('cs-banner-dismissed')) {
      setTimeout(() => setVisible(true), 500);
    } else {
      setMounted(false);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => {
      localStorage.setItem('cs-banner-dismissed', '1');
      setMounted(false);
    }, 600);
  };

  if (!mounted) return null;

  return (
    <div style={{
      position: 'fixed',
      top: visible ? '24px' : '-100px',
      left: '50%',
      transform: 'translateX(-50%)',
      transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      zIndex: 1000,
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none'
    }}>
      <div style={{
        background: 'rgba(20, 20, 25, 0.7)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '10px 16px 10px 20px',
        borderRadius: '999px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(157, 78, 221, 0.1) inset',
        color: '#fff',
        fontFamily: 'var(--font-sans)',
        fontSize: '13px'
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: 'linear-gradient(135deg, var(--accent), #9d4edd)',
          borderRadius: '50%',
          width: '24px',
          height: '24px',
          boxShadow: '0 0 12px rgba(157, 78, 221, 0.5)'
        }}>
          <IconZap size={12} />
        </div>
        
        <span style={{ fontWeight: 500, letterSpacing: '0.01em' }}>
          <span style={{ opacity: 0.7 }}>Support indie development. </span>
          <a href="#" style={{ color: 'white', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '1px', transition: 'border-color 0.2s' }}>
            Upgrade to Pro
          </a>
        </span>

        <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        <button 
          onClick={dismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            lineHeight: 1,
            width: '24px',
            height: '24px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'none'; }}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
