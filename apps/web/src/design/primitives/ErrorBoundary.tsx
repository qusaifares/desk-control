import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Only ever auto-reload once, so a deterministic crash cannot loop forever. */
const RELOAD_MARKER = 'desk-control:auto-reloaded';
const AUTO_RELOAD_AFTER_MS = 20_000;

/**
 * Catches a render crash so the panel does not go blank.
 *
 * This matters more here than in most apps: the primary client is a wall-mounted
 * touchscreen with no keyboard, so "the screen went white" means a power cycle.
 * The fallback stays on screen, says what happened, and offers a finger-sized
 * way out.
 *
 * It also reloads itself once after a delay, because nobody may be standing in
 * front of it - but only once. A crash that reproduces immediately would
 * otherwise turn into a reload loop, which is worse than a stopped panel
 * because it destroys the evidence.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Desk Control UI crashed', error, info.componentStack);

    let alreadyReloaded = true;
    try {
      alreadyReloaded = window.sessionStorage.getItem(RELOAD_MARKER) === 'true';
      window.sessionStorage.setItem(RELOAD_MARKER, 'true');
    } catch {
      // Private mode or blocked storage: skip the auto-reload rather than risk
      // looping without a way to record that we tried.
    }

    if (!alreadyReloaded) {
      this.reloadTimer = setTimeout(() => window.location.reload(), AUTO_RELOAD_AFTER_MS);
    }
  }

  override componentWillUnmount(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="ds-crash" role="alert">
        <h1 className="ds-crash-title">The panel hit a problem</h1>
        <p className="ds-crash-body">
          Your desk has not changed. Monitors, keyboard and mouse are all still wherever they were —
          this is only the screen that stopped.
        </p>
        <pre className="ds-crash-detail">{error.message}</pre>
        <button
          type="button"
          className="ds-button"
          data-variant="primary"
          onClick={() => window.location.reload()}
        >
          Reload the panel
        </button>
      </div>
    );
  }
}
