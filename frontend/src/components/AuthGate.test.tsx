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
import { AuthGate } from './AuthGate';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn(), reloadPage: vi.fn() }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

afterEach(() => vi.unstubAllGlobals());

describe('AuthGate', () => {
  it('reads the snake_case session and treats a missing operator flag as false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(me)));
    renderGate();
    expect(
      await screen.findByText(
        'alice via GitHub, operator false, auth off false, ends 2026-10-14T00:00:00.000Z',
      ),
    ).toBeInTheDocument();
  });

  it('passes the operator flag through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...me, operator: true })));
    renderGate();
    expect(await screen.findByText(/operator true/)).toBeInTheDocument();
  });

  it('offers sign-in on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderGate();
    expect(await screen.findByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
    expect(screen.queryByText(/session ended/i)).not.toBeInTheDocument();
  });

  it('sets the product name in the page title style, not an off-scale size', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderGate();
    const name = await screen.findByRole('heading', { level: 1, name: 'Sluby Studio' });
    expect(name).toHaveClass('text-title');
    expect(name).not.toHaveClass('text-3xl');
  });

  it('says the server is unreachable on a 502 and retries without signing in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html>Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      )
      .mockResolvedValueOnce(json(me));
    vi.stubGlobal('fetch', fetchMock);
    renderGate();

    // it answered, so "could not reach" would send people checking their network
    expect(await screen.findByText('The server ran into a problem')).toBeInTheDocument();
    expect(screen.queryByText('Could not reach the server')).not.toBeInTheDocument();
    expect(screen.getByText(/It answered with error 502\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says a busy server asks to wait, not that it answered with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '30' },
        }),
      ),
    );
    renderGate();
    expect(await screen.findByText('Could not check your session')).toBeInTheDocument();
    expect(
      screen.getByText('Too many requests. Wait 30 seconds and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/It answered with error/)).not.toBeInTheDocument();
  });

  it('does not take the studio page served for /api as a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><title>Sluby</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    renderGate();
    expect(await screen.findByText('Could not check your session')).toBeInTheDocument();
    expect(
      screen.getByText(/Check that requests to \/api reach the Sluby backend\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/via GitHub/)).not.toBeInTheDocument();
  });

  it('does not call an unreadable answer error 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }),
        ),
    );
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
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    renderGate();

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    // no swap to a bare spinner screen: the message stays and the button says what it does
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server');
    expect(screen.getByRole('button', { name: /trying again/i })).toBeDisabled();

    answer(json(me));
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
  });

  it('shows the sign-in as pending while the browser goes to github', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: /sign in with github/i }));
    expect(loadPage).toHaveBeenCalledWith(
      `/api/v1/auth/github/login?${new URLSearchParams({ next: '/' })}`,
    );
    expect(screen.getByRole('button', { name: /redirecting to github/i })).toBeDisabled();
  });

  it('returns to sign-in and drops cached data when a later call answers 401', async () => {
    let signedIn = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/auth/me') return json(me);
        if (!signedIn) return json({ error: 'Not signed in' }, 401);
        return json({ total: 3 });
      }),
    );

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
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
    expect(screen.queryByText('3 videos')).not.toBeInTheDocument();
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
  });

  it('also returns to sign-in when a mutation answers 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/v1/auth/me' ? json(me) : json({ error: 'Not signed in' }, 401),
      ),
    );
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(me))
      .mockResolvedValueOnce(json({ error: 'Not signed in' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    renderGate();
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    // signed out in the meantime, then Back restores this document from the cache
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await waitFor(() => expect(screen.queryByText(/alice via GitHub/)).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /Sign in with GitHub/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not check again on a normal pageshow', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(me));
    vi.stubGlobal('fetch', fetchMock);
    renderGate();
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(screen.getByText(/alice via GitHub/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('AuthGate reasons (B-11)', () => {
  const unauthorized = (reason?: string) =>
    json({ error: 'Not signed in', ...(reason ? { reason } : {}) }, 401);

  it.each([
    ['expired', 'Your session expired. Sign in again to continue.'],
    ['revoked', 'You were signed out from another browser.'],
  ])('says why on load when the 401 says %s, with the sign-in button', async (reason, text) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorized(reason)));
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
  });

  it('says nothing for a plain missing session on load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorized('missing')));
    renderGate();
    expect(await screen.findByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers no sign-in when the account left the allowlist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorized('not_allowed')));
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Your GitHub account is no longer on this Studio's allowlist. Ask the operator to add it back.",
    );
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Using the API/)).not.toBeInTheDocument();
  });

  it('carries the reason of a later 401 from apiClient to the screen', async () => {
    let signedIn = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/v1/auth/me') return json(me);
        return signedIn ? json({ total: 1 }) : unauthorized('revoked');
      }),
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/v1/auth/me' ? json(me) : unauthorized('expired'),
      ),
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/v1/auth/me' ? json(me) : unauthorized(),
      ),
    );
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
});

describe('AuthGate, a 401 without a reason', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the session check why, as for an upload the server refused in plain text', async () => {
    let revoked = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) !== '/api/v1/auth/me') return json({ error: 'Not signed in' }, 401);
        return revoked ? json({ error: 'Not signed in', reason: 'revoked' }, 401) : json(me);
      }),
    );
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
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('offers no sign-in button when github sign-in is not set up, since it would only fail', async () => {
    window.history.replaceState(null, '', '/studio?signin_error=not_configured');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in with GitHub is not set up on this server.',
    );
    expect(screen.queryByRole('button', { name: /sign in with github/i })).not.toBeInTheDocument();
  });

  it.each([
    ['expired_handshake', '', 'That sign-in link expired. Try again.'],
    [
      'not_allowed',
      '&handle=octo-cat',
      "GitHub account octo-cat is not on this Studio's allowlist.",
    ],
    ['not_allowed', '', "That GitHub account is not on this Studio's allowlist."],
    ['provider_failed', '', 'GitHub did not confirm the sign-in. Try again.'],
    ['cancelled', '', 'Sign-in was canceled on GitHub.'],
    ['something_new', '', 'Sign-in did not finish. Try again.'],
  ])('shows %s above the button and takes it out of the url', async (code, extra, text) => {
    window.history.replaceState(
      null,
      '',
      `/studio/videos?view=grid&signin_error=${code}${extra}#top`,
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/studio/videos?view=grid#top',
    );
  });

  it('renders the handle as text, never as markup', async () => {
    window.history.replaceState(
      null,
      '',
      `/studio?signin_error=not_allowed&handle=${encodeURIComponent('<b>x</b>')}`,
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderGate();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("GitHub account <b>x</b> is not on this Studio's allowlist.");
    expect(alert.querySelector('b')).toBeNull();
  });

  it('signs in with a next that no longer carries the failure', async () => {
    window.history.replaceState(null, '', '/studio/settings?signin_error=provider_failed');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: /sign in with github/i }));
    expect(loadPage).toHaveBeenCalledWith(
      `/api/v1/auth/github/login?${new URLSearchParams({ next: '/studio/settings' })}`,
    );
  });

  it('keeps the hash of the page in the sign-in next', async () => {
    window.history.replaceState(null, '', '/studio/videos/a1?panel=share#embed');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: /sign in with github/i }));
    expect(loadPage).toHaveBeenCalledWith(
      `/api/v1/auth/github/login?${new URLSearchParams({ next: '/studio/videos/a1?panel=share#embed' })}`,
    );
  });

  it('drops the failure when the session is fine after all', async () => {
    window.history.replaceState(null, '', '/studio?signin_error=expired_handshake');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(me)));
    renderGate();
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
});
