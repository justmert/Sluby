import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import type { AuthSession } from '@/lib/session';
import { WithSession } from '@/test/session';
import { formatTimeLeft as timeLeft } from '@/lib/formatters';
import SettingsPage from './SettingsPage';

let sessions: Array<Record<string, unknown>>;
let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sessions = [
    {
      id: 's1',
      user_agent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      created_at: '2026-10-05T00:00:00Z',
      expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      current: true,
    },
    {
      id: 's2',
      user_agent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
      created_at: '2026-10-04T00:00:00Z',
      expires_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      current: false,
    },
  ];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // the sdk asks with absolute urls, apiClient with paths
    const url = String(input).replace(window.location.origin, '');
    const method = init?.method ?? 'GET';
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

const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) => String(u) === url && ((init as RequestInit)?.method ?? 'GET') === method,
  );

describe('formatTimeLeft', () => {
  const at = (ms: number) => new Date(1_000_000 + ms).toISOString();
  it('reads naturally around the hour and day boundaries', () => {
    expect(timeLeft(at(59 * 60_000 + 30_000), 1_000_000)).toBe('in 1 hour');
    expect(timeLeft(at(5 * 60_000), 1_000_000)).toBe('in 5 minutes');
    expect(timeLeft(at(26 * 3_600_000), 1_000_000)).toBe('in 1 day 2 hours');
    expect(timeLeft(at(-1), 1_000_000)).toBe('now');
  });
});

describe('SettingsPage', () => {
  const renderSettings = (session: Partial<AuthSession> = {}) =>
    renderPage(
      <WithSession {...session}>
        <SettingsPage />
      </WithSession>,
    );

  it('has the account, browsers and appearance sections and no API keys', async () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Your account, browsers and appearance')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Account',
      'Signed-in browsers',
      'Appearance',
    ]);
    await screen.findByText('Safari on iPhone');
    expect(screen.queryByText('API keys')).not.toBeInTheDocument();
    expect(calls('GET', '/api/v1/keys')).toHaveLength(0);
  });

  it('asks for no server status: the version and network live in the sidebar now', async () => {
    renderSettings();
    await screen.findByText('Safari on iPhone');
    expect(calls('GET', '/api/v1/system/status')).toHaveLength(0);
  });

  it('leaves out signed-in browsers and sign out when sign-in is off', async () => {
    renderSettings({ authDisabled: true, username: 'dev', provider: 'local', operator: true });
    expect(screen.getByText('Sign-in is off on this server')).toBeInTheDocument();
    expect(screen.queryByText('Signed-in browsers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
    expect(calls('GET', '/api/v1/auth/sessions')).toHaveLength(0);
  });
});
