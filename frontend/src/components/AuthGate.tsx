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
import {
  SessionContext,
  sessionEndReasonOf,
  sessionFromMe,
  type AuthSession,
  type MeResponse,
  type SessionEndReason,
  type SignInError,
} from '@/lib/session';
import { onUnauthorized } from '@/lib/session-events';

type GateState =
  | { kind: 'loading' }
  | { kind: 'signedIn'; session: AuthSession }
  /**
   * `ended` when the session went away while the studio was open; `reason`
   * is the server's account of why, when it gave one (plan B-11).
   */
  | { kind: 'signedOut'; ended: boolean; reason?: SessionEndReason }
  /**
   * The server did not answer usefully; signing in again would not help.
   * `answered` tells an error reply apart from a request that never arrived.
   */
  | { kind: 'unreachable'; answered: boolean; detail: string };

/** What the sign-in screen says about a session that ended. Null says nothing. */
function endedMessage(ended: boolean, reason: SessionEndReason | undefined): string | null {
  switch (reason) {
    case 'expired':
      return 'Your session expired. Sign in again to continue.';
    case 'revoked':
      return 'You were signed out from another browser.';
    case 'not_allowed':
      return "Your GitHub account is no longer on this Studio's allowlist. Ask the operator to add it back.";
    default:
      // "missing" means no session cookie came with the request: on a first
      // visit that is just signed out, mid-session it means the cookie went
      return ended ? 'Your session ended. Sign in again to continue.' : null;
  }
}

interface SignInFailure {
  code: SignInError | string;
  /** The GitHub login the allowlist refused, for not_allowed. */
  handle: string | null;
}

/** Why the last sign-in did not finish, as the GitHub callback put it in the url (plan B-12). */
function signInFailureText({ code, handle }: SignInFailure): string {
  switch (code) {
    case 'expired_handshake':
      return 'That sign-in link expired. Try again.';
    case 'not_allowed':
      return handle
        ? `GitHub account ${handle} is not on this Studio's allowlist.`
        : "That GitHub account is not on this Studio's allowlist.";
    case 'cancelled':
      return 'Sign-in was canceled on GitHub.';
    case 'provider_failed':
      return 'GitHub did not confirm the sign-in. Try again.';
    case 'not_configured':
      return 'Sign-in with GitHub is not set up on this server.';
    default:
      return 'Sign-in did not finish. Try again.';
  }
}

/**
 * Read `signin_error` (and `handle`) once and take them out of the url, so a
 * reload or a shared link does not show the failure again and the next
 * sign-in does not carry it back as its `next`.
 */
function takeSignInFailure(): SignInFailure | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('signin_error');
  if (code === null) return null;
  const handle = url.searchParams.get('handle');
  url.searchParams.delete('signin_error');
  url.searchParams.delete('handle');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return { code, handle };
}

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
      <main className="flex w-full max-w-sm flex-col items-center gap-8 px-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <Logo className="size-11" />
          <h1 className="font-heading text-title">Sluby Studio</h1>
          <p className="text-sm text-muted-foreground">Self-hosted video, stored on Sia</p>
        </div>
        {/* the brand stays put while what is below it changes. the old and new
            content share one grid cell instead of waiting for each other:
            with mode="wait" the next screen mounted only after the previous
            one's exit finished, and when /auth/me answered before motion's
            features had loaded, that exit never finished and the sign-in
            button never appeared (FLW-01). the spinner has no exit at all. */}
        <div className="grid w-full *:col-start-1 *:row-start-1">
          <AnimatePresence initial={false}>
            {contentKey === 'loading' ? (
              <div key="loading" className="flex min-h-24 w-full flex-col items-center gap-8">
                {children}
              </div>
            ) : (
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
            )}
          </AnimatePresence>
        </div>
      </main>
    </m.div>
  );
}

function SignIn({
  message,
  failure,
  canSignIn,
}: {
  message: string | null;
  failure: string | null;
  /** False when signing in again cannot help (the account left the allowlist). */
  canSignIn: boolean;
}) {
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
      {(message || failure) && (
        <div role="alert" className="flex flex-col gap-1.5 text-sm">
          {message && <p>{message}</p>}
          {failure && <p dir="auto">{failure}</p>}
        </div>
      )}
      {canSignIn && (
        <>
          <Button
            size="lg"
            disabled={redirecting}
            onClick={() => {
              setRedirecting(true);
              loadPage(githubLoginUrl());
            }}
          >
            {redirecting ? <Spinner aria-hidden="true" /> : <GitHubMark className="size-4" />}
            {redirecting ? 'Redirecting to GitHub…' : 'Sign in with GitHub'}
          </Button>
          <p className="max-w-xs text-xs text-muted-foreground">
            Using the API? Create an API key under Developers after you sign in.
          </p>
        </>
      )}
    </>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // a retry keeps the error on screen with a pending button until it answers
  const [retrying, setRetrying] = useState(false);
  // read before the first check, while the url still has it
  const [failure] = useState(takeSignInFailure);

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
          setState({ kind: 'signedOut', ended: false, reason: sessionEndReasonOf(err) });
          return;
        }
        setState({
          kind: 'unreachable',
          answered: status !== undefined,
          detail:
            status !== undefined
              ? `It answered with error ${status}. Try again in a moment. If it keeps happening, check the server logs.`
              : 'Check that the server is running and your connection works, then try again.',
        });
      })
      .finally(() => {
        if (!cancelled) setRetrying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // the back/forward cache can restore this page after sign out with the
  // signed-in pages still in it; hide them and ask the server again
  useEffect(() => {
    const recheck = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      // the pages unmount with this, and the effect below then drops their cache
      setState({ kind: 'loading' });
      setAttempt((n) => n + 1);
    };
    window.addEventListener('pageshow', recheck);
    return () => window.removeEventListener('pageshow', recheck);
  }, []);

  // a 401 from any later call means the session ended (expiry, sign out
  // everywhere, allowlist removal); go back to sign-in rather than leave the
  // pages showing errors and stale data
  useEffect(() => {
    let active = true;
    const end = (reason: SessionEndReason | undefined) =>
      setState((prev) =>
        prev.kind === 'signedIn' ? { kind: 'signedOut', ended: true, reason } : prev,
      );
    const stop = onUnauthorized((reason) => {
      if (reason !== undefined) {
        end(reason);
        return;
      }
      // the upload endpoint answers 401 in plain text, without a reason; the
      // session check gives one, so the screen can say what happened
      apiClient.get<MeResponse>('/auth/me').then(
        () => active && end(undefined),
        (err: unknown) =>
          active && end(statusOf(err) === 401 ? sessionEndReasonOf(err) : undefined),
      );
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

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
            {state.answered ? 'The server ran into a problem' : 'Could not reach the server'}
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
          {retrying ? 'Trying again…' : 'Try again'}
        </Button>
      </Screen>
    );
  }

  const message = endedMessage(state.ended, state.reason);
  return (
    <Screen contentKey={message ? `ended-${state.reason ?? ''}` : 'signedOut'}>
      <SignIn
        message={message}
        // a failed sign-in is old news once the session has ended since
        failure={failure && !state.ended ? signInFailureText(failure) : null}
        canSignIn={state.reason !== 'not_allowed'}
      />
    </Screen>
  );
}
