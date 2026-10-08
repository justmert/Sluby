import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert, RotateCcw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageState } from '@/components/layout/PageState';
import { reloadPage } from '@/lib/navigation';

// how chromium, firefox and safari word a dynamic import that failed, and
// vite's message when a chunk's css could not be loaded
const CHUNK_LOAD_ERRORS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
];

function isChunkLoadError(error: Error): boolean {
  return CHUNK_LOAD_ERRORS.some((pattern) => pattern.test(error.message));
}

const RELOADED_AT_KEY = 'sluby-chunk-reload-at';

/**
 * A redeploy replaces the hashed chunks, so a tab opened before it fails to
 * load the next page; reloading picks up the new build. Only once a minute,
 * so a chunk that is really missing shows the error instead of looping.
 */
function reloadForNewBuild(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT_KEY));
    if (Number.isFinite(last) && now - last < 60_000) return false;
    sessionStorage.setItem(RELOADED_AT_KEY, String(now));
  } catch {
    // without storage there is no loop guard, so do not reload on our own
    return false;
  }
  reloadPage();
  return true;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** A new value clears a caught error, e.g. the route, so leaving a broken page recovers. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    if (!isChunkLoadError(error)) return;
    // offline, the chunk is missing because the network is, not because of a
    // new build; reloading now would swap the studio for the browser's
    // offline page. wait for the connection and try the page again then.
    if (!navigator.onLine) {
      window.addEventListener('online', this.retryOnline, { once: true });
      return;
    }
    reloadForNewBuild();
  }

  componentWillUnmount(): void {
    window.removeEventListener('online', this.retryOnline);
  }

  private retryOnline = () => reloadPage();

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    if (chunk && !navigator.onLine) {
      return (
        <PageState
          icon={WifiOff}
          title="You are offline"
          description="This page loads when the connection is back."
          detail={error.message}
        />
      );
    }
    return (
      <PageState
        icon={CircleAlert}
        tone="error"
        title={chunk ? 'This page could not be loaded' : 'Something went wrong'}
        description={
          chunk
            ? 'The Studio may have been updated since this tab opened. Reload to get the new version.'
            : 'Reload the page, or open another page from the menu.'
        }
        detail={error.message}
        actions={
          <Button onClick={reloadPage}>
            <RotateCcw />
            Reload
          </Button>
        }
      />
    );
  }
}
