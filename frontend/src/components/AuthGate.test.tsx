import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { createQueryClient } from '@/lib/query-client';
import { useSession } from '@/lib/session';
import { AuthGate } from './AuthGate';

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
    <QueryClientProvider client={client}>
      <AuthGate>{children}</AuthGate>
    </QueryClientProvider>,
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

    expect(await screen.findByText('Could not reach the server')).toBeInTheDocument();
    expect(screen.getByText('The server answered HTTP 502.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/alice via GitHub/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says the server is unreachable when the request never arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderGate();
    expect(await screen.findByText('The request did not reach the server.')).toBeInTheDocument();
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

    expect(await screen.findByText('Your session ended. Sign in again to continue.')).toBeInTheDocument();
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
});
