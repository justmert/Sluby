import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { Logo } from '@/components/brand/Logo';
import { apiClient, statusOf } from '@/lib/api-client';
import { SessionContext, sessionFromMe, type AuthSession, type MeResponse } from '@/lib/session';
import { onUnauthorized } from '@/lib/session-events';

type GateState =
  | { kind: 'loading' }
  | { kind: 'signedIn'; session: AuthSession }
  | { kind: 'signedOut'; ended: boolean }
  /** The server did not answer usefully; signing in again would not help. */
  | { kind: 'unreachable'; detail: string };

function startGitHubLogin() {
  const next = window.location.pathname + window.location.search;
  window.location.href = `/api/v1/auth/github/login?${new URLSearchParams({ next })}`;
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 px-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <Logo className="size-11 text-lg" />
          <h1 className="text-3xl font-semibold">Sluby Studio</h1>
          <p className="text-sm text-muted-foreground">Decentralized video streaming on Sia</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<MeResponse>('/auth/me')
      .then((me) => {
        if (!cancelled) setState({ kind: 'signedIn', session: sessionFromMe(me) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = statusOf(err);
        if (status === 401) {
          setState({ kind: 'signedOut', ended: false });
          return;
        }
        setState({
          kind: 'unreachable',
          detail:
            status !== undefined
              ? `The server answered ${err instanceof Error ? err.message : status}.`
              : 'The request did not reach the server.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // a 401 from any later call means the session ended (expiry, sign out
  // everywhere, allowlist removal); go back to sign-in rather than leave the
  // pages showing errors and stale data
  useEffect(
    () =>
      onUnauthorized(() =>
        setState((prev) => (prev.kind === 'signedIn' ? { kind: 'signedOut', ended: true } : prev)),
      ),
    [],
  );

  const signedIn = state.kind === 'signedIn';
  useEffect(() => {
    // runs after the pages unmounted, so nothing refetches what is dropped
    if (!signedIn) queryClient.clear();
  }, [signedIn, queryClient]);

  if (state.kind === 'loading') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (state.kind === 'signedIn') {
    return <SessionContext.Provider value={state.session}>{children}</SessionContext.Provider>;
  }

  if (state.kind === 'unreachable') {
    return (
      <Screen>
        <div role="alert" className="flex flex-col gap-1.5">
          <p className="font-medium">Could not reach the server</p>
          <p className="text-sm text-muted-foreground">{state.detail}</p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            setState({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          <RotateCcw />
          Try again
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      {state.ended && (
        <p role="alert" className="text-sm">
          Your session ended. Sign in again to continue.
        </p>
      )}
      <Button size="lg" onClick={startGitHubLogin}>
        <GitHubMark className="size-4" />
        Sign in with GitHub
      </Button>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        The REST API and SDK accept API keys for programmatic use.
      </p>
    </Screen>
  );
}
