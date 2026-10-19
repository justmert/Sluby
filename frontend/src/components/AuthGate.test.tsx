import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { domMax } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { sluby } from '@/lib/sluby';
import { apiClient } from '@/lib/api-client';
import { loadPage } from '@/lib/navigation';
import { createQueryClient } from '@/lib/query-client';
import { useSession } from '@/lib/session';
import { toastError } from '@/lib/toast';
import { jsonFetch, reply } from '@/test/render';
import { AuthGate } from './AuthGate';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn(), reloadPage: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }));

// what the api sends today, without the deprecated camelCase copies
const me = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  provider: 'github',
  provider_label: 'GitHub',
  auth_disabled: false,
  expires_at: '2026-10-14T00:00:00.000Z',
};

const config = {
  auth_disabled: false,
  setup_required: false,
  methods: { password: true, github: true },
};

const signedOut = (reason?: string) =>
  reply(401, { error: 'Not signed in', ...(reason ? { reason } : {}) });

const ME = '/api/v1/auth/me';

/** The gate's two checks and the version line, plus `routes`. */
function stub(routes: Record<string, unknown>) {
  const fetchStub = jsonFetch({
    '/api/v1/auth/config': config,
    '/health': { status: 'ok', version: '0.2.0' },
    ...routes,
  });
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

const meCalls = (f: ReturnType<typeof stub>) => f.calls.filter((c) => c.path === ME).length;

function Who() {
  const s = useSession();
  return (
    <p>
      {s.username} via {s.providerLabel}, operator {String(s.operator)}, auth off{' '}
      {String(s.authDisabled)}, ends {s.expiresAt}
    </p>
  );
}

function renderGate(children = <Who />) {
  const client = createQueryClient();
  render(
    <MotionProvider features={domMax}>
      <QueryClientProvider client={client}>
        <AuthGate>{children}</AuthGate>
      </QueryClientProvider>
    </MotionProvider>,
  );
  return client;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(loadPage).mockClear();
  vi.mocked(toastError).mockClear();
  window.history.replaceState(null, '', '/');
});

describe('AuthGate', () => {
  it('reads the snake_case session and treats a missing operator flag as false', async () => {
    stub({ [ME]: me });
    renderGate();
    expect(
      await screen.findByText(
        'alice via GitHub, operator false, auth off false, ends 2026-10-14T00:00:00.000Z',
      ),
    ).toBeInTheDocument();
  });

  it('passes the operator flag through', async () => {
    stub({ [ME]: { ...me, operator: true } });
    renderGate();
    expect(await screen.findByText(/operator true/)).toBeInTheDocument();
  });

  it('offers the password form and github on a 401', async () => {
    stub({ [ME]: signedOut() });
    renderGate();
    expect(await screen.findByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    expect(screen.queryByText(/session ended/i)).not.toBeInTheDocument();
  });

  it('leaves github out when the server has not set it up', async () => {
    stub({
      [ME]: signedOut(),
      '/api/v1/auth/config': { ...config, methods: { password: true, github: false } },
    });
    renderGate();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue with github/i })).not.toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });

  it('does not wait for the config when signed in, and does not need it', async () => {
    stub({ [ME]: me, '/api/v1/auth/config': reply(500, { error: 'boom' }) });
    renderGate();
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
  });

  it('says the server has a problem when the config fails while signed out', async () => {
    stub({ [ME]: signedOut(), '/api/v1/auth/config': reply(503, { error: 'down' }) });
    renderGate();
    expect(await screen.findByText('The server ran into a problem')).toBeInTheDocument();
  });

  it('sets the product name in the page title style, not an off-scale size', async () => {
    stub({ [ME]: signedOut() });
    renderGate();
    const name = await screen.findByRole('heading', { level: 1, name: 'Sign in to Sluby Studio' });
    expect(name).toHaveClass('text-title');
    expect(name).not.toHaveClass('text-3xl');
  });

  it('says the server is unreachable on a 502 and retries without signing in', async () => {
    let first = true;
    const f = stub({
      [ME]: () => {
        if (!first) return me;
        first = false;
        return new Response('<html>Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        });
      },
    });
    renderGate();

    // it answered, so "could not reach" would send people checking their network
    expect(await screen.findByText('The server ran into a problem')).toBeInTheDocument();
    expect(screen.queryByText('Could not reach the server')).not.toBeInTheDocument();
    expect(screen.getByText(/It answered with error 502\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    expect(meCalls(f)).toBe(2);
  });

  it('says a busy server asks to wait, not that it answered with an error', async () => {
    stub({
      [ME]: () =>
        new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '30' },
        }),
    });
    renderGate();
    expect(await screen.findByText('Could not check your session')).toBeInTheDocument();
    expect(
      screen.getByText('Too many requests. Wait 30 seconds and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/It answered with error/)).not.toBeInTheDocument();
  });

  it('does not take the studio page served for /api as a session', async () => {
    stub({
      [ME]: () =>
        new Response('<!doctype html><title>Sluby</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    });
    renderGate();
    expect(await screen.findByText('Could not check your session')).toBeInTheDocument();
    expect(
      screen.getByText(/Check that requests to \/api reach the Sluby backend\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/via GitHub/)).not.toBeInTheDocument();
  });

  it('does not call an unreadable answer error 200', async () => {
    stub({
      [ME]: () =>
        new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    renderGate();
    expect(await screen.findByText('Could not check your session')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong. Try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByText(/error 200/)).not.toBeInTheDocument();
  });

  it('says the server is unreachable when the request never arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderGate();
    expect(
      await screen.findByText(
        'Check that the server is running and your connection works, then try again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Could not reach the server')).toBeInTheDocument();
  });

  it('keeps the error on screen while trying again, with the button pending', async () => {
    let answer: (r: Response) => void = () => {};
    let calls = 0;
    stub({
      [ME]: () => {
        calls++;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return new Promise<Response>((resolve) => (answer = resolve));
      },
    });
    renderGate();

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    // no swap to a bare spinner screen: the message stays and the button says what it does
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server');
    expect(screen.getByRole('button', { name: /trying again/i })).toBeDisabled();

    answer(new Response(JSON.stringify(me), { headers: { 'content-type': 'application/json' } }));
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
  });

  it('shows the github sign-in as pending while the browser goes to github', async () => {
    stub({ [ME]: signedOut() });
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    expect(loadPage).toHaveBeenCalledWith(
      `/api/v1/auth/github/login?${new URLSearchParams({ next: '/' })}`,
    );
    expect(screen.getByRole('button', { name: /redirecting to github/i })).toBeDisabled();
  });

  it('returns to sign-in and drops cached data when a later call answers 401', async () => {
    let signedIn = true;
    stub({
      [ME]: me,
      '/api/v1/stats': () => (signedIn ? { total: 3 } : signedOut()),
    });

    function Library() {
      const stats = useQuery({
        queryKey: ['stats'],
        queryFn: () => apiClient.get<{ total: number }>('/stats'),
      });
      return <p>{stats.data ? `${stats.data.total} videos` : 'loading'}</p>;
    }

    const client = renderGate(<Library />);
    expect(await screen.findByText('3 videos')).toBeInTheDocument();

    signedIn = false;
    await client.refetchQueries({ queryKey: ['stats'] });

    expect(
      await screen.findByText('Your session ended. Sign in again to continue.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('3 videos')).not.toBeInTheDocument();
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
  });

  it('also returns to sign-in when a mutation answers 401', async () => {
    stub({ [ME]: me, 'POST /api/v1/keys': signedOut() });
    const client = renderGate();
    await screen.findByText(/alice via GitHub/);
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => apiClient.post('/keys', { name: 'k' }) })
      .execute(undefined)
      .catch(() => {});
    expect(await screen.findByText(/your session ended/i)).toBeInTheDocument();
  });

  it('checks the session again when the back/forward cache restores the page (FLW-07)', async () => {
    let calls = 0;
    const f = stub({ [ME]: () => (++calls === 1 ? me : signedOut()) });
    renderGate();
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    // signed out in the meantime, then Back restores this document from the cache
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await waitFor(() => expect(screen.queryByText(/alice via GitHub/)).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(meCalls(f)).toBe(2);
  });

  it('does not check again on a normal pageshow', async () => {
    const f = stub({ [ME]: me });
    renderGate();
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(screen.getByText(/alice via GitHub/)).toBeInTheDocument();
    expect(meCalls(f)).toBe(1);
  });
});

describe('AuthGate reasons (B-11)', () => {
  it.each([
    ['expired', 'Your session expired. Sign in again to continue.'],
    ['revoked', 'You were signed out from another browser.'],
  ])('says why on load when the 401 says %s, with the sign-in form', async (reason, text) => {
    stub({ [ME]: signedOut(reason) });
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('says nothing for a plain missing session on load', async () => {
    stub({ [ME]: signedOut('missing') });
    renderGate();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says a removed account was removed, and still lets someone else sign in', async () => {
    stub({ [ME]: signedOut('not_allowed') });
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account was removed from this workspace. Ask an admin to restore it.',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('carries the reason of a later 401 from apiClient to the screen', async () => {
    let signedIn = true;
    stub({ [ME]: me, '/api/v1/stats': () => (signedIn ? { total: 1 } : signedOut('revoked')) });
    function Stats() {
      const q = useQuery({ queryKey: ['stats'], queryFn: () => apiClient.get('/stats') });
      return <p>{q.data ? 'loaded' : 'loading'}</p>;
    }
    const client = renderGate(<Stats />);
    await screen.findByText('loaded');
    signedIn = false;
    await client.refetchQueries({ queryKey: ['stats'] });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You were signed out from another browser.',
    );
  });

  it('carries the reason of a later 401 from the sdk to the screen', async () => {
    stub({ [ME]: me, '/api/v1/assets': signedOut('expired') });
    function Videos() {
      const q = useQuery({ queryKey: ['assets'], queryFn: () => sluby.assets.list() });
      return <p>{q.isPending ? 'loading' : 'done'}</p>;
    }
    renderGate(<Videos />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session expired. Sign in again to continue.',
    );
  });

  it('keeps the generic line when a later 401 gives no reason', async () => {
    stub({ [ME]: me, 'POST /api/v1/keys': signedOut() });
    const client = renderGate();
    await screen.findByText(/alice via GitHub/);
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => apiClient.post('/keys', { name: 'k' }) })
      .execute(undefined)
      .catch(() => {});
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session ended. Sign in again to continue.',
    );
  });

  it('asks the session check why, as for an upload the server refused in plain text', async () => {
    let revoked = false;
    stub({
      [ME]: () => (revoked ? signedOut('revoked') : me),
      'POST /api/v1/keys': signedOut(),
    });
    const client = renderGate();
    await screen.findByText(/alice via GitHub/);
    revoked = true;
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => apiClient.post('/keys', { name: 'k' }) })
      .execute(undefined)
      .catch(() => {});
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You were signed out from another browser.',
    );
  });
});

describe('AuthGate sign-in failures (B-12)', () => {
  it('offers no github button when github sign-in is not set up, but keeps the password form', async () => {
    window.history.replaceState(null, '', '/studio?signin_error=not_configured');
    stub({ [ME]: signedOut() });
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in with GitHub is not set up on this server.',
    );
    expect(screen.queryByRole('button', { name: /continue with github/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it.each([
    ['expired_handshake', '', 'That sign-in link expired. Try again.'],
    [
      'not_a_member',
      '&handle=octo-cat',
      'GitHub account octo-cat is not a member of this workspace. Ask an admin for an invite.',
    ],
    [
      'not_a_member',
      '',
      'That GitHub account is not a member of this workspace. Ask an admin for an invite.',
    ],
    ['disabled', '', 'This account was removed from this workspace. Ask an admin to restore it.'],
    [
      'already_linked',
      '&handle=octo-cat',
      'GitHub account octo-cat already belongs to another member.',
    ],
    ['not_signed_in', '', 'Sign in first, then link GitHub from Settings.'],
    ['invite_not_found', '', 'That invite link does not exist. Ask an admin for a new one.'],
    ['invite_used', '', 'That invite link was already used. Ask an admin for a new one.'],
    ['invite_expired', '', 'That invite link has expired. Ask an admin for a new one.'],
    ['invite_revoked', '', 'That invite link was withdrawn. Ask an admin for a new one.'],
    ['provider_failed', '', 'GitHub did not confirm the sign-in. Try again.'],
    ['cancelled', '', 'Sign-in was canceled on GitHub.'],
    ['something_new', '', 'Sign-in did not finish. Try again.'],
  ])('shows %s above the form and takes it out of the url', async (code, extra, text) => {
    window.history.replaceState(
      null,
      '',
      `/studio/videos?view=grid&signin_error=${code}${extra}#top`,
    );
    stub({ [ME]: signedOut() });
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/studio/videos?view=grid#top',
    );
  });

  it('renders the handle as text, never as markup', async () => {
    window.history.replaceState(
      null,
      '',
      `/studio?signin_error=not_a_member&handle=${encodeURIComponent('<b>x</b>')}`,
    );
    stub({ [ME]: signedOut() });
    renderGate();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('GitHub account <b>x</b> is not a member of this workspace.');
    expect(alert.querySelector('b')).toBeNull();
  });

  it('signs in with a next that no longer carries the failure', async () => {
    window.history.replaceState(null, '', '/studio/settings?signin_error=provider_failed');
    stub({ [ME]: signedOut() });
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    expect(loadPage).toHaveBeenCalledWith(
      `/api/v1/auth/github/login?${new URLSearchParams({ next: '/studio/settings' })}`,
    );
  });

  it('keeps the hash of the page in the sign-in next', async () => {
    window.history.replaceState(null, '', '/studio/videos/a1?panel=share#embed');
    stub({ [ME]: signedOut() });
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: /continue with github/i }));
    expect(loadPage).toHaveBeenCalledWith(
      `/api/v1/auth/github/login?${new URLSearchParams({ next: '/studio/videos/a1?panel=share#embed' })}`,
    );
  });

  it('shows a failure that comes back to a signed-in browser as a toast, from linking github', async () => {
    window.history.replaceState(
      null,
      '',
      '/studio/settings?signin_error=already_linked&handle=octo-cat',
    );
    stub({ [ME]: me });
    renderGate();
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(toastError).toHaveBeenCalledWith(
      'GitHub account octo-cat already belongs to another member.',
    );
  });
});

describe('AuthGate sign-in screen (design board)', () => {
  it('names the server version from /health and links the docs under the card', async () => {
    stub({ [ME]: signedOut() });
    renderGate();
    expect(await screen.findByText(/Sluby 0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Docs, opens in a new tab' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(
      screen.getByText('Video hosting on your own server, stored on Sia.'),
    ).toBeInTheDocument();
    expect(screen.getByText('New here? Ask an admin for an invite link.')).toBeInTheDocument();
  });

  it('names the product without a number when /health does not answer', async () => {
    stub({ [ME]: signedOut(), '/health': reply(502, { error: 'Bad Gateway' }) });
    renderGate();
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.getByText(/^Sluby ·/)).toBeInTheDocument();
  });
});
