import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { Logo } from '@/components/brand/Logo';
import { apiClient, ApiError } from '@/lib/api-client';

/** The signed-in account, as GET /auth/me returns it. */
export interface AuthSession {
  /** The account id. */
  id: string;
  /** The account's display name. */
  name: string;
  /** The handle of the identity this browser signed in with, e.g. the GitHub login. */
  username: string;
  /** Which sign-in provider that identity belongs to, e.g. "github", or "local" in dev mode. */
  provider: string | null;
  providerLabel: string | null;
  expiresAt?: number;
  authDisabled?: boolean;
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'signedIn'; session: AuthSession }
  | { kind: 'signedOut'; reason?: string };

const SessionContext = createContext<AuthSession | null>(null);

/** The signed-in Studio session. Only valid below the AuthGate. */
export function useSession(): AuthSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used below AuthGate');
  return session;
}

function startGitHubLogin() {
  const next = window.location.pathname + window.location.search;
  window.location.href = `/api/v1/auth/github/login?${new URLSearchParams({ next })}`;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<AuthSession>('/auth/me')
      .then((session) => {
        if (!cancelled) setState({ kind: 'signedIn', session });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setState({ kind: 'signedOut' });
        } else {
          setState({
            kind: 'signedOut',
            reason: err instanceof Error ? err.message : 'Unable to reach the server.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 px-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <Logo className="size-11 text-lg" />
          <h1 className="text-3xl font-semibold">Sluby Studio</h1>
          <p className="text-sm text-muted-foreground">Decentralized video streaming on Sia</p>
        </div>

        <Button size="lg" onClick={startGitHubLogin}>
          <GitHubMark className="size-4" />
          Sign in with GitHub
        </Button>

        {state.reason && (
          <p role="alert" className="max-w-xs text-xs text-destructive">
            {state.reason}
          </p>
        )}

        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          The REST API and SDK accept API keys for programmatic use.
        </p>
      </div>
    </div>
  );
}
