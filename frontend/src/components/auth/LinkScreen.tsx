import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { apiClient, statusOf } from '@/lib/api-client';
import { AuthNotice, AuthScreen, ProductLine } from './AuthScreen';
import { JoinScreen } from './JoinScreen';
import type { LinkInfo, LinkPath } from './link';
import { ResetScreen } from './ResetScreen';
import { authErrorText } from './sign-in-copy';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; info: LinkInfo }
  | { kind: 'failed'; error: unknown; retrying: boolean };

const TITLES = { join: 'Join Sluby Studio', reset: 'Set a new password' } as const;

/**
 * The page an invite or reset link opens, before anyone is signed in: what
 * the link is for, then its form, or why it no longer works.
 */
export function LinkScreen({
  link,
  onSignedIn,
}: {
  link: LinkPath;
  onSignedIn: () => Promise<boolean>;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ask = new AbortController();
    apiClient
      .get<LinkInfo>(`/auth/invites/${encodeURIComponent(link.token)}`, { signal: ask.signal })
      .then(
        (info) => setState({ kind: 'ready', info }),
        (error: unknown) => {
          if (!ask.signal.aborted) setState({ kind: 'failed', error, retrying: false });
        },
      );
    return () => ask.abort();
  }, [link.token, attempt]);

  const kind =
    state.kind === 'ready' ? (state.info.kind === 'invite' ? 'join' : 'reset') : link.kind;
  const title = TITLES[kind];

  if (state.kind === 'loading') {
    return (
      <AuthScreen contentKey="loading" title={title}>
        <Spinner className="size-6 text-muted-foreground" aria-label="Checking the link" />
      </AuthScreen>
    );
  }

  if (state.kind === 'failed') {
    const status = statusOf(state.error);
    // a link that is gone stays gone; a server that did not answer may later
    const final = status === 403 || status === 404 || status === 410;
    return (
      <AuthScreen contentKey="failed" title={title} footer={<ProductLine />}>
        <AuthNotice>
          <p>{authErrorText(state.error)}</p>
        </AuthNotice>
        {!final && (
          <Button
            size="lg"
            className="w-full"
            disabled={state.retrying}
            onClick={() => {
              setState({ ...state, retrying: true });
              setAttempt((n) => n + 1);
            }}
          >
            {state.retrying ? <Spinner aria-hidden="true" /> : <RotateCcw />}
            {state.retrying ? 'Trying again…' : 'Try again'}
          </Button>
        )}
        <Button variant={final ? 'default' : 'outline'} size="lg" className="w-full" asChild>
          <a href="/studio">Go to sign in</a>
        </Button>
      </AuthScreen>
    );
  }

  const { info } = state;
  return (
    <AuthScreen contentKey={info.kind} title={title} footer={<ProductLine />}>
      {info.kind === 'invite' ? (
        <JoinScreen
          token={link.token}
          role={info.role}
          expiresAt={info.expires_at}
          github={info.github}
          onSignedIn={onSignedIn}
        />
      ) : (
        <ResetScreen
          token={link.token}
          email={info.email}
          expiresAt={info.expires_at}
          onSignedIn={onSignedIn}
        />
      )}
    </AuthScreen>
  );
}
