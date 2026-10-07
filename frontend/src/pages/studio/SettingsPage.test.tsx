import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import type { AuthSession } from '@/lib/session';
import { WithSession } from '@/test/session';
import { formatTimeLeft as timeLeft } from '@/lib/formatters';
import SettingsPage from './SettingsPage';

let keys: Array<Record<string, unknown>>;
let sessions: Array<Record<string, unknown>>;
let fetchMock: ReturnType<typeof vi.fn>;
let keyPages: Array<Array<Record<string, unknown>>> | null;
let createAnswer: (body: Record<string, unknown>) => Response;
let rotateAnswer: () => Response;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  keys = [
    {
      id: 'k1',
      name: 'production',
      scopes: ['upload', 'read'],
      rate_limit: 100,
      is_active: true,
      created_at: '2026-10-01T00:00:00Z',
      expires_at: null,
    },
  ];
  sessions = [
    {
      id: 's1',
      user_agent: 'Mozilla/5.0 (Macintosh) Chrome/141',
      created_at: '2026-10-05T00:00:00Z',
      expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      current: true,
    },
    {
      id: 's2',
      user_agent: 'Mozilla/5.0 (iPhone) Safari/18',
      created_at: '2026-10-04T00:00:00Z',
      expires_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      current: false,
    },
  ];
  keyPages = null;
  createAnswer = (body) =>
    json(
      {
        id: 'k2',
        is_active: true,
        created_at: new Date().toISOString(),
        expires_at: null,
        key: 'sluby_newsecret',
        ...body,
      },
      201,
    );
  rotateAnswer = () =>
    json(
      {
        id: 'k3',
        key: 'sluby_rotatedsecret',
        name: 'production',
        scopes: ['upload', 'read'],
        rate_limit: 100,
        is_active: true,
        created_at: new Date().toISOString(),
        expires_at: null,
        rotated_from: 'k1',
        previous_key_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      201,
    );
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/v1/keys' && method === 'GET') {
      if (!keyPages) return json({ data: keys, has_more: false, next_cursor: null });
      return json({ data: keyPages[0], has_more: true, next_cursor: 'c1' });
    }
    if (url === '/api/v1/keys?cursor=c1' && keyPages) {
      return json({ data: keyPages[1], has_more: false, next_cursor: null });
    }
    if (url === '/api/v1/keys' && method === 'POST') {
      return createAnswer(JSON.parse(String(init!.body)));
    }
    if (url === '/api/v1/keys/k1/rotate') return rotateAnswer();
    if (url === '/api/v1/keys/k1' && method === 'DELETE') return json({ success: true });
    if (url === '/api/v1/auth/sessions' && method === 'GET') return json({ data: sessions });
    if (url === '/api/v1/auth/sessions/s2' && method === 'DELETE') {
      sessions = sessions.filter((x) => x.id !== 's2');
      return json({ success: true });
    }
    if (url === '/api/v1/system/status')
      return json({ version: '0.1.0', indexer: { network: 'mainnet' } });
    return json({ error: `unmocked ${method} ${url}` }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const render = (session: Partial<AuthSession> = {}) =>
  renderPage(
    <ThemeProvider>
      <WithSession {...session}>
        <SettingsPage />
      </WithSession>
      <Toaster />
    </ThemeProvider>,
  );

const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) => String(u) === url && ((init as RequestInit)?.method ?? 'GET') === method,
  );

describe('SettingsPage', () => {
  it('creates a key and shows the secret exactly once', async () => {
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'ci');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /manage/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

    expect(await screen.findByTestId('issued-key')).toHaveTextContent('sluby_newsecret');
    expect(JSON.parse(String(calls('POST', '/api/v1/keys')[0][1].body))).toEqual({
      name: 'ci',
      scopes: ['upload', 'read', 'manage'],
      rate_limit: 100,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('issued-key')).not.toBeInTheDocument());
  });

  it('rotates with a grace period and tells when the old key stops', async () => {
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /rotate/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'After 24 hours' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /rotate key/i }),
    );

    expect(await screen.findByTestId('issued-key')).toHaveTextContent('sluby_rotatedsecret');
    expect(JSON.parse(String(calls('POST', '/api/v1/keys/k1/rotate')[0][1].body))).toEqual({
      grace_period_seconds: 86400,
    });
    expect(screen.getByText(/previous key stops working on/)).toBeInTheDocument();
  });

  it('shows a key in its grace period as expiring, without another rotate', async () => {
    keys[0].expires_at = new Date(Date.now() + 2 * 3_600_000).toISOString();
    render();
    expect(await screen.findByText(/Expires in (1h 59m|2h 0m)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('revokes after confirmation', async () => {
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(calls('DELETE', '/api/v1/keys/k1')).toHaveLength(1));
  });

  it('switches the theme', async () => {
    render();
    await userEvent.click(screen.getByRole('radio', { name: /light/i }));
    expect(document.documentElement).toHaveClass('light');
    await userEvent.click(screen.getByRole('radio', { name: /dark/i }));
    expect(document.documentElement).toHaveClass('dark');
  });
});

describe('formatTimeLeft', () => {
  const at = (ms: number) => new Date(1_000_000 + ms).toISOString();
  it('reads naturally around the hour and day boundaries', () => {
    expect(timeLeft(at(59 * 60_000 + 30_000), 1_000_000)).toBe('in 1h 0m');
    expect(timeLeft(at(5 * 60_000), 1_000_000)).toBe('in 5m');
    expect(timeLeft(at(26 * 3_600_000), 1_000_000)).toBe('in 1d 2h');
    expect(timeLeft(at(-1), 1_000_000)).toBe('now');
  });
});

describe('SettingsPage sessions', () => {
  it('lists the signed-in sessions and ends another one', async () => {
    render();
    await screen.findByText('Mozilla/5.0 (iPhone) Safari/18');
    expect(screen.getByText('This browser')).toBeInTheDocument();
    const iphoneRow = screen.getByText('Mozilla/5.0 (iPhone) Safari/18').closest('tr')!;
    await userEvent.click(within(iphoneRow).getByRole('button', { name: /end/i }));
    await waitFor(() => expect(calls('DELETE', '/api/v1/auth/sessions/s2')).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByText('Mozilla/5.0 (iPhone) Safari/18')).not.toBeInTheDocument(),
    );
  });

  it('does not talk about signed-in browsers when sign-in is off', async () => {
    render({ authDisabled: true, username: 'dev', provider: 'local' });
    expect(
      await screen.findByText(
        'Sign-in is off on this server, so nobody signs in and there are no sessions.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Browsers signed in/)).not.toBeInTheDocument();
    expect(calls('GET', '/api/v1/auth/sessions')).toHaveLength(0);
  });
});

describe('SettingsPage keys', () => {
  it('lists every page of keys', async () => {
    keyPages = [[keys[0]], [{ ...keys[0], id: 'k9', name: 'old backup' }]];
    render();
    expect(await screen.findByText('old backup')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
  });

  it('explains the key cap when the server refuses a new key', async () => {
    createAnswer = () =>
      json({ error: 'This account already has 50 API keys; delete one first' }, 409);
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'one more');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(await within(dialog).findByText('Key limit reached')).toBeInTheDocument();
    expect(
      within(dialog).getByText('This account already has 50 API keys; delete one first'),
    ).toBeInTheDocument();
  });

  it('keeps issued secrets out of the mutation cache', async () => {
    const { client } = render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'ci');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(await screen.findByTestId('issued-key')).toHaveTextContent('sluby_newsecret');
    const cached = JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.data),
    );
    expect(cached).not.toContain('sluby_newsecret');
  });

  it('closes the rotate dialog and explains a key that is already gone', async () => {
    rotateAnswer = () => json({ error: 'API key not found' }, 404);
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /rotate/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /rotate key/i }));
    expect(
      await screen.findByText('production no longer exists; the list is refreshed'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the rotate dialog and explains a key rotated elsewhere', async () => {
    rotateAnswer = () =>
      json({ error: 'API key was already rotated; rotate its replacement instead' }, 409);
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /rotate/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /rotate key/i }));
    expect(
      await screen.findByText('production was already rotated; rotate its replacement instead'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('tells a rotated pair apart by key id', async () => {
    keys.push({
      ...keys[0],
      id: 'f00dcafe-0000-4000-8000-000000000002',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    keys[0].id = 'abcd1234-0000-4000-8000-000000000001';
    render();
    expect(await screen.findByText('id abcd1234')).toBeInTheDocument();
    expect(screen.getByText('id f00dcafe')).toBeInTheDocument();
  });

  it('shows the role on the account card', async () => {
    render({ operator: true });
    expect(
      await screen.findByText('Operator: sees deployment status and metrics'),
    ).toBeInTheDocument();
  });
});
