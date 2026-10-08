import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
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
    <WithSession {...session}>
      <SettingsPage />
    </WithSession>,
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
    expect(await screen.findByText(/Expires in (1 hour 59 minutes|2 hours)/)).toBeInTheDocument();
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
    expect(timeLeft(at(59 * 60_000 + 30_000), 1_000_000)).toBe('in 1 hour');
    expect(timeLeft(at(5 * 60_000), 1_000_000)).toBe('in 5 minutes');
    expect(timeLeft(at(26 * 3_600_000), 1_000_000)).toBe('in 1 day 2 hours');
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

// jsdom runs no css, so radix unmounts a closing dialog at once and the exit
// frame is never seen; an exit animation name makes radix wait for
// animationend like a browser does, so the test can look at that frame
function holdDialogExits() {
  const style = document.createElement('style');
  style.textContent =
    '[role=dialog][data-state=closed],[role=alertdialog][data-state=closed]{animation-name:exit}';
  document.head.append(style);
  return () => style.remove();
}

describe('SettingsPage dialogs while they close', () => {
  let release: () => void;
  beforeEach(() => {
    release = holdDialogExits();
  });
  afterEach(() => release());

  it('keeps the rotate title while the dialog animates out', async () => {
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /rotate/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog).toHaveAttribute('data-state', 'closed');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Rotate production');
  });

  it('keeps the revoke title while the dialog animates out', async () => {
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog).toHaveAttribute('data-state', 'closed');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Revoke production?');
  });

  it('keeps the rotated secret and its title while the secret dialog closes', async () => {
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /rotate/i }));
    const rotate = await screen.findByRole('dialog');
    await userEvent.click(within(rotate).getByRole('button', { name: /rotate key/i }));
    const secret = await screen.findByTestId('issued-key');
    const dialog = secret.closest('[role=dialog]') as HTMLElement;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(dialog).toHaveAttribute('data-state', 'closed');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Key rotated: production');
    expect(secret).toHaveTextContent('sluby_rotatedsecret');
  });
});

describe('SettingsPage keys on phones', () => {
  it('lays the key table out as stacked rows with the actions pinned in view', async () => {
    render();
    const name = await screen.findByText('production');
    const table = name.closest('table')!;
    expect(table).toHaveAttribute('data-responsive');
    const actions = screen.getByRole('button', { name: /revoke/i }).closest('td')!;
    expect(actions).toHaveAttribute('data-cell', 'actions');
    expect(within(actions).getByRole('button', { name: /rotate/i })).toBeInTheDocument();
  });
});

describe('SettingsPage key forms and optimistic rows', () => {
  it('starts every create from the defaults, not the last key', async () => {
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'ci');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /manage/ }));
    const rate = within(dialog).getByLabelText('Rate limit');
    await userEvent.clear(rate);
    await userEvent.type(rate, '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));

    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('');
    expect(within(dialog).getByRole('checkbox', { name: /manage/ })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /upload/ })).toBeChecked();
    expect(within(dialog).getByLabelText('Rate limit')).toHaveValue(100);
  });

  it('explains what is wrong inline instead of sending an invalid key', async () => {
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /upload/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /read/ }));
    const rate = within(dialog).getByLabelText('Rate limit');
    await userEvent.clear(rate);
    await userEvent.type(rate, '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

    expect(within(dialog).getByText(/Give the key a name/)).toBeInTheDocument();
    expect(within(dialog).getByText('Pick at least one scope.')).toBeInTheDocument();
    expect(within(dialog).getByText(/whole number of requests/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    expect(calls('POST', '/api/v1/keys')).toHaveLength(0);
  });

  it('removes a revoked key at once and puts it back when the server refuses', async () => {
    let answer!: (r: Response) => void;
    const base = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/keys/k1' && init?.method === 'DELETE') {
        return new Promise<Response>((r) => (answer = r));
      }
      return base(input, init);
    });
    render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke' }),
    );
    await waitFor(() => expect(screen.queryByText('production')).not.toBeInTheDocument());

    answer(json({ error: 'database is down' }, 500));
    expect(await screen.findByText('production')).toBeInTheDocument();
    expect(
      await screen.findByText('Could not revoke production: database is down'),
    ).toBeInTheDocument();
  });

  it('shows a creating row while the server makes the key, without the secret in the cache', async () => {
    let answer!: (r: Response) => void;
    const base = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/keys' && init?.method === 'POST') {
        return new Promise<Response>((r) => (answer = r));
      }
      return base(input, init);
    });
    const { client } = render();
    await screen.findByText('production');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'ci');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

    expect(within(dialog).getByRole('button', { name: /creating/i })).toBeDisabled();
    const pendingRow = screen.getByText('ci').closest('tr')!;
    expect(pendingRow).toHaveAttribute('aria-busy', 'true');

    answer(createAnswer({ name: 'ci', scopes: ['upload', 'read'], rate_limit: 100 }));
    expect(await screen.findByTestId('issued-key')).toHaveTextContent('sluby_newsecret');
    expect(JSON.stringify(client.getQueryData(['api-keys']))).not.toContain('sluby_newsecret');
  });
});

describe('SettingsPage sessions, optimistic', () => {
  it('drops an ended session at once and restores it when ending fails', async () => {
    let answer!: (r: Response) => void;
    const base = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/auth/sessions/s2' && init?.method === 'DELETE') {
        return new Promise<Response>((r) => (answer = r));
      }
      return base(input, init);
    });
    render();
    const ua = 'Mozilla/5.0 (iPhone) Safari/18';
    const row = (await screen.findByText(ua)).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /end/i }));
    await waitFor(() => expect(screen.queryByText(ua)).not.toBeInTheDocument());
    answer(json({ error: 'nope' }, 500));
    expect(await screen.findByText('Could not end the session: nope')).toBeInTheDocument();
    expect(screen.getByText(ua)).toBeInTheDocument();
  });

  it('shapes the loading keys like the rows they stand for, stacked on phones', async () => {
    let answer!: (r: Response) => void;
    const held = new Promise<Response>((r) => (answer = r));
    const answerKeys = fetchMock.getMockImplementation() as (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/v1/keys' ? held : answerKeys(input, init),
    );
    const { container } = render();
    const card = screen.getByText('API keys').closest('[data-slot=card]')!;
    const blocks = [...card.querySelectorAll('[data-slot=skeleton]')];
    // a table header and two 53px rows from sm up; below sm the header is
    // hidden and each row is a 132px stacked card, so the cards under it
    // do not jump when two keys land
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toHaveClass('h-9', 'max-sm:hidden');
    expect(blocks[1]).toHaveClass('h-12', 'max-sm:h-32');
    expect(blocks[2]).toHaveClass('h-12', 'max-sm:h-32');
    answer(json({ data: keys, has_more: false, next_cursor: null }));
    await screen.findByText('production');
    expect(container.querySelector('[data-slot=card] [data-slot=skeleton]')).toBeNull();
  });
});

describe('SettingsPage deep link', () => {
  it('opens the create key dialog from ?create=key and drops the param on close', async () => {
    renderPage(
      <WithSession>
        <SettingsPage />
      </WithSession>,
      { route: '/studio/settings?create=key' },
    );
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // closed for good: the param is gone, so a re-render does not reopen it
    await screen.findByText('production');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
