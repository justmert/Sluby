import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { Logo } from '@/components/brand/Logo';
import { apiClient, statusOf } from '@/lib/api-client';
import { LINKS } from '@/lib/constants';
import { describeError, errorText } from '@/lib/errors';
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
   * `title` tells a server error, any other reply and a request that never
   * arrived apart.
   */
  | { kind: 'unreachable'; title: string; detail: string };

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
  const next = window.location.pathname + window.location.search + window.location.hash;
  return `/api/v1/auth/github/login?${new URLSearchParams({ next })}`;
}

// a fast answer never shows the loading screen at all, so a signed-in
// reload goes straight to the studio without a spinner flashing first
const LOADING_DELAY = 0.15;

const DOCS_URL = `${LINKS.SOURCE}/blob/main/docs/index.md`;

/**
 * The server's version for the line under the card, from the public liveness
 * check (the status endpoint needs a session). Until it answers, or if it
 * cannot, the line names the product without a number.
 */
function useServerVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const ask = new AbortController();
    fetch('/health', { signal: ask.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ version?: unknown }>) : null))
      .then((body) => {
        if (typeof body?.version === 'string') setVersion(body.version);
      })
      .catch((err: unknown) => {
        // an abort is this screen going away, not a failure
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.warn('could not read the server version from /health', err);
        }
      });
    return () => ask.abort();
  }, []);
  return version;
}

function Screen({
  children,
  contentKey,
  title = 'Sluby Studio',
  footer,
}: {
  children: ReactNode;
  contentKey: string;
  title?: string;
  /** under the card, such as the version and docs line of the sign-in screen */
  footer?: ReactNode;
}) {
  return (
    // the design's sign-in: the mark, the title and one line, a raised card
    // that rises in, and the version and docs under it, centred on the ground
    <m.div
      className="fixed inset-0 grid place-items-center overflow-y-auto bg-background px-5 py-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...transition.base, delay: contentKey === 'loading' ? LOADING_DELAY : 0 }}
    >
      <main className="flex w-full max-w-100 flex-col items-center gap-6 text-center">
        <Logo className="size-12" />
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="font-heading text-title">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Video hosting on your own server, stored on Sia.
          </p>
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
                className="flex w-full flex-col gap-3.5 rounded-3xl border bg-card p-6 text-left shadow-toast"
              >
                {children}
              </m.div>
            )}
          </AnimatePresence>
        </div>
        {footer}
      </main>
    </m.div>
  );
}

/** "Sluby 0.2.0 · Docs" under the sign-in card. */
function ProductLine() {
  const version = useServerVersion();
  return (
    <p className="text-[13px] text-subtle-foreground">
      {version ? `Sluby ${version}` : 'Sluby'} ·{' '}
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary-hover"
      >
        Docs<span className="sr-only">, opens in a new tab</span>
      </a>
    </p>
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
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-warning-line px-3.5 py-3 text-sm"
        >
          <CircleAlert aria-hidden="true" className="mt-px size-4.5 shrink-0 text-warning-icon" />
          <div className="flex flex-col gap-1.5">
            {message && <p>{message}</p>}
            {failure && <p dir="auto">{failure}</p>}
          </div>
        </div>
      )}
      {canSignIn && (
        <>
          {/* the one action on the screen, in the inverse of the page like
              github's own mark */}
          <Button
            size="lg"
            disabled={redirecting}
            onClick={() => {
              setRedirecting(true);
              loadPage(githubLoginUrl());
            }}
            className="h-11 w-full gap-2.5 rounded-lg border-foreground bg-foreground font-semibold text-background hover:bg-[color-mix(in_oklab,var(--foreground),var(--background)_15%)] pointer-coarse:h-11"
          >
            {redirecting ? <Spinner aria-hidden="true" /> : <GitHubMark className="size-5" />}
            {redirecting ? 'Redirecting to GitHub…' : 'Continue with GitHub'}
          </Button>
          <p className="text-center text-[13px] text-muted-foreground">
            Only accounts your operator allows can sign in.
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
        if (status === undefined && describeError(err).kind === 'offline') {
          setState({
            kind: 'unreachable',
            title: 'Could not reach the server',
            detail: 'Check that the server is running and your connection works, then try again.',
          });
        } else if (status !== undefined && status >= 500) {
          setState({
            kind: 'unreachable',
            title: 'The server ran into a problem',
            detail: `It answered with error ${status}. Try again in a moment. If it keeps happening, check the server logs.`,
          });
        } else {
          // a 429, an answer that is not json, a route the server lacks
          setState({
            kind: 'unreachable',
            title: 'Could not check your session',
            detail: errorText(err),
          });
        }
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
          <p className="font-semibold">{state.title}</p>
          <p className="text-sm text-muted-foreground">{state.detail}</p>
        </div>
        <Button
          size="lg"
          className="w-full"
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
    <Screen
      contentKey={message ? `ended-${state.reason ?? ''}` : 'signedOut'}
      title="Sign in to Sluby Studio"
      footer={<ProductLine />}
    >
      <SignIn
        message={message}
        // a failed sign-in is old news once the session has ended since
        failure={failure && !state.ended ? signInFailureText(failure) : null}
        // signing in cannot help an account off the allowlist, or a server
        // with no github sign-in set up
        canSignIn={
          state.reason !== 'not_allowed' && !(failure?.code === 'not_configured' && !state.ended)
        }
      />
    </Screen>
  );
}
