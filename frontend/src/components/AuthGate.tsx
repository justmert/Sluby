import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { Logo } from '@/components/brand/Logo';
import { apiClient, statusOf } from '@/lib/api-client';
import { fadeUp, transition } from '@/lib/motion';
import { loadPage } from '@/lib/navigation';
import { SessionContext, sessionFromMe, type AuthSession, type MeResponse } from '@/lib/session';
import { onUnauthorized } from '@/lib/session-events';

type GateState =
  | { kind: 'loading' }
  | { kind: 'signedIn'; session: AuthSession }
  | { kind: 'signedOut'; ended: boolean }
  /**
   * The server did not answer usefully; signing in again would not help.
   * `answered` tells an error reply apart from a request that never arrived.
   */
  | { kind: 'unreachable'; answered: boolean; detail: string };

function githubLoginUrl() {
  const next = window.location.pathname + window.location.search;
  return `/api/v1/auth/github/login?${new URLSearchParams({ next })}`;
}

// a fast answer never shows the loading screen at all, so a signed-in
// reload goes straight to the studio without a spinner flashing first
const LOADING_DELAY = 0.15;

function Screen({ children, contentKey }: { children: ReactNode; contentKey: string }) {
  return (
    <m.div
      className="fixed inset-0 flex items-center justify-center bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...transition.base, delay: contentKey === 'loading' ? LOADING_DELAY : 0 }}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-8 px-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <Logo className="size-11 text-lg" />
          <h1 className="text-3xl font-semibold">Sluby Studio</h1>
          <p className="text-sm text-muted-foreground">Decentralized video streaming on Sia</p>
        </div>
        {/* the brand stays put while what is below it changes */}
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={contentKey}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="flex min-h-24 w-full flex-col items-center gap-8"
          >
            {children}
          </m.div>
        </AnimatePresence>
      </div>
    </m.div>
  );
}

function SignIn({ ended }: { ended: boolean }) {
  const [redirecting, setRedirecting] = useState(false);

  // coming back with the browser's back button can restore this page from
  // the cache with the button still pending; let it be pressed again
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  return (
    <>
      {ended && (
        <p role="alert" className="text-sm">
          Your session ended. Sign in again to continue.
        </p>
      )}
      <Button
        size="lg"
        disabled={redirecting}
        onClick={() => {
          setRedirecting(true);
          loadPage(githubLoginUrl());
        }}
      >
        {redirecting ? <Spinner aria-hidden="true" /> : <GitHubMark className="size-4" />}
        {redirecting ? 'Redirecting to GitHub...' : 'Sign in with GitHub'}
      </Button>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        The REST API and SDK accept API keys for programmatic use.
      </p>
    </>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // a retry keeps the error on screen with a pending button until it answers
  const [retrying, setRetrying] = useState(false);

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
          answered: status !== undefined,
          detail:
            status !== undefined
              ? `The server answered ${err instanceof Error ? err.message : status}.`
              : 'The request did not reach the server.',
        });
      })
      .finally(() => {
        if (!cancelled) setRetrying(false);
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

  if (state.kind === 'signedIn') {
    return <SessionContext.Provider value={state.session}>{children}</SessionContext.Provider>;
  }

  if (state.kind === 'loading') {
    return (
      <Screen contentKey="loading">
        <Spinner className="size-6 text-muted-foreground" aria-label="Checking your session" />
      </Screen>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <Screen contentKey="unreachable">
        <div role="alert" className="flex flex-col gap-1.5">
          <p className="font-medium">
            {state.answered ? 'The server returned an error' : 'Could not reach the server'}
          </p>
          <p className="text-sm text-muted-foreground">{state.detail}</p>
        </div>
        <Button
          size="lg"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            setAttempt((n) => n + 1);
          }}
        >
          {retrying ? <Spinner aria-hidden="true" /> : <RotateCcw />}
          {retrying ? 'Trying again...' : 'Try again'}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen contentKey={state.ended ? 'ended' : 'signedOut'}>
      <SignIn ended={state.ended} />
    </Screen>
  );
}
