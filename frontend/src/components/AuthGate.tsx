import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { AuthScreen, ProductLine } from '@/components/auth/AuthScreen';
import { linkFromPath, type LinkPath } from '@/components/auth/link';
import { LinkScreen } from '@/components/auth/LinkScreen';
import { SetupScreen } from '@/components/auth/SetupScreen';
import { SignInScreen } from '@/components/auth/SignInScreen';
import { endedMessage, signInFailureText, takeSignInFailure } from '@/components/auth/sign-in-copy';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { fetchAuthConfig, type AuthConfig } from '@/hooks/useAuthConfig';
import { apiClient, statusOf } from '@/lib/api-client';
import { describeError, errorText } from '@/lib/errors';
import {
  SessionContext,
  sessionEndReasonOf,
  sessionFromMe,
  type AuthSession,
  type MeResponse,
  type SessionEndReason,
} from '@/lib/session';
import { onUnauthorized } from '@/lib/session-events';
import { toastError } from '@/lib/toast';

type GateState =
  | { kind: 'loading' }
  | { kind: 'signedIn'; session: AuthSession }
  /**
   * `ended` when the session went away while the studio was open; `reason`
   * is the server's account of why, when it gave one (plan B-11). `config`
   * says which ways to sign in to offer.
   */
  | { kind: 'signedOut'; ended: boolean; reason?: SessionEndReason; config: AuthConfig }
  /**
   * The server did not answer usefully; signing in again would not help.
   * `title` tells a server error, any other reply and a request that never
   * arrived apart.
   */
  | { kind: 'unreachable'; title: string; detail: string };

type Settled = Exclude<GateState, { kind: 'loading' }>;

function unreachable(err: unknown): Settled {
  const status = statusOf(err);
  if (status === undefined && describeError(err).kind === 'offline') {
    return {
      kind: 'unreachable',
      title: 'Could not reach the server',
      detail: 'Check that the server is running and your connection works, then try again.',
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      kind: 'unreachable',
      title: 'The server ran into a problem',
      detail: `It answered with error ${status}. Try again in a moment. If it keeps happening, check the server logs.`,
    };
  }
  // a 429, an answer that is not json, a route the server lacks
  return { kind: 'unreachable', title: 'Could not check your session', detail: errorText(err) };
}

/**
 * Ask who is signed in, and, for the sign-in screen, how one signs in here.
 * Both go out at once so a signed-out load waits for one round trip; a
 * signed-in one does not wait for the config at all.
 */
async function checkSession(): Promise<Settled> {
  const config = fetchAuthConfig();
  // read only when signed out; a failure then is reported below
  config.catch(() => {});
  try {
    const me = await apiClient.get<MeResponse>('/auth/me');
    return { kind: 'signedIn', session: sessionFromMe(me) };
  } catch (err) {
    if (statusOf(err) !== 401) return unreachable(err);
    const reason = sessionEndReasonOf(err);
    try {
      return { kind: 'signedOut', ended: false, reason, config: await config };
    } catch (configErr) {
      return unreachable(configErr);
    }
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // a retry keeps the error on screen with a pending button until it answers
  const [retrying, setRetrying] = useState(false);
  // read before the first check, while the url still has it
  const [failure] = useState(takeSignInFailure);
  // null until someone picks: a server with no admin opens on setup, since
  // nobody can sign in there yet
  const [view, setView] = useState<'signIn' | 'setup' | null>(null);
  // an invite or reset link renders without a session; the gate sits outside
  // the router, so it reads the path itself
  const [link, setLink] = useState<LinkPath | null>(() => linkFromPath(window.location.pathname));
  const onLink = useRef(link !== null);
  // what the 401 listener below reads, outside of render
  const current = useRef<GateState>(state);
  useEffect(() => {
    current.current = state;
  }, [state]);

  useEffect(() => {
    if (onLink.current) return;
    let cancelled = false;
    void checkSession().then((next) => {
      if (cancelled) return;
      setState(next);
      setRetrying(false);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /**
   * After a sign-in, setup or link: ask again and show the result. False
   * when the browser still has no session, so the form can say so; an
   * unreachable server shows its own screen.
   */
  const recheck = useCallback(async (): Promise<boolean> => {
    const next = await checkSession();
    setState(next);
    return next.kind !== 'signedOut';
  }, []);

  const finishLink = useCallback(async (): Promise<boolean> => {
    const next = await checkSession();
    if (next.kind === 'signedOut') return false;
    // the studio has no page at the link's path, and the link is spent
    window.history.replaceState(null, '', '/studio');
    onLink.current = false;
    setState(next);
    setLink(null);
    return true;
  }, []);

  // the back/forward cache can restore this page after sign out with the
  // signed-in pages still in it; hide them and ask the server again
  useEffect(() => {
    const again = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      // the pages unmount with this, and the effect below then drops their cache
      setState({ kind: 'loading' });
      setAttempt((n) => n + 1);
    };
    window.addEventListener('pageshow', again);
    return () => window.removeEventListener('pageshow', again);
  }, []);

  // a 401 from any later call means the session ended (expiry, sign out
  // everywhere, removal from the workspace); go back to sign-in rather than
  // leave the pages showing errors and stale data
  useEffect(() => {
    let active = true;
    const end = (reason: SessionEndReason | undefined) => {
      if (current.current.kind !== 'signedIn') return;
      // the pages go at once; the sign-in screen follows with the config
      setState({ kind: 'loading' });
      fetchAuthConfig().then(
        (config) =>
          active &&
          setState((prev) =>
            prev.kind === 'loading' ? { kind: 'signedOut', ended: true, reason, config } : prev,
          ),
        (err: unknown) =>
          active && setState((prev) => (prev.kind === 'loading' ? unreachable(err) : prev)),
      );
    };
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

  // a failure that comes back to a signed-in browser is from linking GitHub
  // in Settings; there is no sign-in screen to show it on
  const toasted = useRef(false);
  useEffect(() => {
    if (!signedIn || !failure || toasted.current) return;
    toasted.current = true;
    toastError(signInFailureText(failure));
  }, [signedIn, failure]);

  if (link) return <LinkScreen link={link} onSignedIn={finishLink} />;

  if (state.kind === 'signedIn') {
    return <SessionContext.Provider value={state.session}>{children}</SessionContext.Provider>;
  }

  if (state.kind === 'loading') {
    return (
      <AuthScreen contentKey="loading">
        <Spinner className="size-6 text-muted-foreground" aria-label="Checking your session" />
      </AuthScreen>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <AuthScreen contentKey="unreachable">
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
      </AuthScreen>
    );
  }

  const { config } = state;
  if ((view ?? (config.setup_required ? 'setup' : 'signIn')) === 'setup' && config.setup_required) {
    return (
      <AuthScreen contentKey="setup" title="Set up Sluby Studio" footer={<ProductLine />}>
        <SetupScreen
          onBack={(refresh) => {
            setView('signIn');
            if (refresh) void recheck();
          }}
          onSignedIn={recheck}
        />
      </AuthScreen>
    );
  }

  const message = endedMessage(state.ended, state.reason);
  // a failed sign-in is old news once the session has ended since
  const shownFailure = failure && !state.ended ? failure : null;
  return (
    <AuthScreen
      contentKey={message ? `ended-${state.reason ?? ''}` : 'signedOut'}
      title="Sign in to Sluby Studio"
      footer={<ProductLine />}
    >
      <SignInScreen
        message={message}
        failure={shownFailure ? signInFailureText(shownFailure) : null}
        // github cannot help a server that does not have it set up
        github={config.methods.github && shownFailure?.code !== 'not_configured'}
        setupRequired={config.setup_required}
        onSetup={() => setView('setup')}
        onSignedIn={recheck}
      />
    </AuthScreen>
  );
}
