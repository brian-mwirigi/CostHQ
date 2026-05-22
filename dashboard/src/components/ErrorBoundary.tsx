import React, { Component, ErrorInfo, ReactNode } from 'react';
import { IconActivity } from './Icons';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: 'var(--bg-root)',
          color: 'var(--text-primary)',
          textAlign: 'center',
          padding: '20px'
        }}>
          <div style={{ marginBottom: 20, color: '#f85149' }}>
            <IconActivity size={48} />
          </div>
          <h1 style={{ marginBottom: 12, fontSize: 24 }}>Something went wrong.</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, maxWidth: 400 }}>
            An unexpected error occurred while rendering the dashboard. 
            Refreshing the page usually fixes this.
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--text-primary)',
              color: 'var(--bg-root)',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px'
            }}
          >
            Reload Dashboard
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
