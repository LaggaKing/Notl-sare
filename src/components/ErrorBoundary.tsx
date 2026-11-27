import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle: string;
  fallbackBody: string;
  actionLabel: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Localized React error boundary that catches render exceptions cleanly
 * and offers a touch-friendly recovery action.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught render error:', error, info);
    }
  }

  private handleAction = () => {
    this.setState({ hasError: false });
    if (this.props.onReset) {
      this.props.onReset();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: '100%',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)',
          }}
        >
          <div
            style={{
              maxWidth: 440,
              width: '100%',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-lg)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              textAlign: 'center',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              {this.props.fallbackTitle}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '0.95rem',
                color: 'var(--text-secondary)',
              }}
            >
              {this.props.fallbackBody}
            </p>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={this.handleAction}
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--text-on-accent)',
                  fontWeight: 600,
                  padding: '0 20px',
                }}
              >
                {this.props.actionLabel}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
