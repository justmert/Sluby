import { useEffect, useState, type ReactNode } from 'react';
import { Github, Loader2 } from 'lucide-react';
import { apiClient, ApiError, BASE_URL } from '@/lib/api-client';

export interface AuthSession {
  login: string;
  expiresAt?: number;
  authDisabled?: boolean;
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'signedIn'; session: AuthSession }
  | { kind: 'signedOut'; reason?: string };

function startGitHubLogin() {
  const next = window.location.pathname + window.location.search;
  const params = new URLSearchParams({ next });
  window.location.href = `${BASE_URL}/api/v1/auth/github/login?${params.toString()}`;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await apiClient.get<AuthSession>('/auth/me');
        if (!cancelled) setState({ kind: 'signedIn', session });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setState({ kind: 'signedOut' });
        } else {
          setState({
            kind: 'signedOut',
            reason: err instanceof Error ? err.message : 'Unable to reach the server.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (state.kind === 'signedIn') {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-8 w-full max-w-sm px-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-3xl font-semibold text-zinc-100 font-heading">Sluby</h1>
          <p className="text-sm text-zinc-500">Decentralized video streaming on Sia</p>
        </div>

        <button
          type="button"
          onClick={startGitHubLogin}
          className="inline-flex items-center gap-2.5 rounded-lg bg-white px-5 py-3 text-sm font-medium text-black transition-colors hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-white"
        >
          <Github className="h-4 w-4" aria-hidden="true" />
          Sign in with GitHub
        </button>

        {state.reason && <p className="text-xs text-red-400 max-w-xs">{state.reason}</p>}

        <p className="text-xs text-zinc-600 max-w-xs leading-relaxed">
          Open to any GitHub account. The backend REST API and SDK still accept API keys for
          programmatic use.
        </p>
      </div>
    </div>
  );
}
