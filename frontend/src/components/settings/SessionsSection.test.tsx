import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replacePage } from '@/lib/navigation';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { WithSession } from '@/test/session';
import { SessionsSection } from './SessionsSection';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn(), replacePage: vi.fn() }));

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + 60_000).toISOString();

type Row = Record<string, unknown>;
let rows: Row[];

beforeEach(() => {
  rows = [
    {
      id: 's1',
      user_agent: MAC_CHROME,
      created_at: '2026-10-01T09:00:00Z',
      expires_at: inDays(6),
      last_seen_at: hoursAgo(0.05),
      current: true,
    },
    {
      id: 's2',
      user_agent: IPHONE_SAFARI,
      created_at: '2026-10-05T09:00:00Z',
      expires_at: inDays(2),
      last_seen_at: hoursAgo(3),
      current: false,
    },
  ];
  vi.mocked(replacePage).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function setup(routes: Record<string, unknown> = {}) {
  const fetch = jsonFetch({ '/api/v1/auth/sessions': () => ({ data: rows }), ...routes });
  vi.stubGlobal('fetch', fetch);
  const page = renderPage(
    <WithSession>
      <SessionsSection />
    </WithSession>,
  );
  return { ...page, fetch };
}

const rowOf = async (label: string) => (await screen.findByText(label)).closest('tr')!;

describe('SessionsSection', () => {
  it('names each browser, keeps the raw agent in a tooltip and marks this one (FLW-27)', async () => {
    setup();
    const mine = await rowOf('Chrome on macOS');
    expect(within(mine).getByText('Chrome on macOS')).toHaveAttribute('title', MAC_CHROME);
    expect(within(mine).getByText('This browser')).toBeInTheDocument();
    const phone = await rowOf('Safari on iPhone');
    expect(phone.querySelector('.lucide-smartphone')).not.toBeNull();
    expect(mine.querySelector('.lucide-monitor')).not.toBeNull();
    expect(screen.getByText(/Where you are signed in as/)).toHaveTextContent(
      'Where you are signed in as alice.',
    );
  });

  it('shows when each browser was last active (B-10)', async () => {
    rows.push({ ...rows[1], id: 's3', last_seen_at: null, user_agent: null });
    setup();
    expect(await screen.findByRole('columnheader', { name: 'Last active' })).toBeInTheDocument();
    expect(within(await rowOf('Chrome on macOS')).getByText('Just now')).toBeInTheDocument();
    expect(within(await rowOf('Safari on iPhone')).getByText('3 hours ago')).toBeInTheDocument();
    expect(within(await rowOf('Unknown browser')).getByText('–')).toBeInTheDocument();
  });

  it('signs out another browser, named in its button, and not this one from the table', async () => {
    const { fetch } = setup({
      'DELETE /api/v1/auth/sessions/s2': () => {
        rows = rows.filter((r) => r.id !== 's2');
        return { success: true };
      },
    });
    const mine = await rowOf('Chrome on macOS');
    expect(within(mine).queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out Safari on iPhone' }));
    expect(await screen.findByText('Signed out that browser')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument());
    expect(fetch.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(screen.getByText('No other browsers are signed in.')).toBeInTheDocument();
  });

  it('keeps keyboard focus in the list when a signed-out row leaves', async () => {
    rows.push({ ...rows[1], id: 's3', user_agent: null });
    setup({
      'DELETE /api/v1/auth/sessions/s2': () => {
        rows = rows.filter((r) => r.id !== 's2');
        return { success: true };
      },
      'DELETE /api/v1/auth/sessions/s3': () => {
        rows = rows.filter((r) => r.id !== 's3');
        return { success: true };
      },
    });
    const first = await screen.findByRole('button', { name: 'Sign out Safari on iPhone' });
    first.focus();
    await userEvent.keyboard('{Enter}');
    const next = screen.getByRole('button', { name: 'Sign out Unknown browser' });
    await waitFor(() => expect(next).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toHaveFocus(),
    );
  });

  it('treats a browser that was already signed out as done', async () => {
    setup({
      'DELETE /api/v1/auth/sessions/s2': () => {
        rows = rows.filter((r) => r.id !== 's2');
        return reply(404, { error: 'Session not found' });
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out Safari on iPhone' }));
    expect(await screen.findByText('That browser was already signed out.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument());
  });

  it('puts the row back and says why when signing out a browser fails', async () => {
    setup({ 'DELETE /api/v1/auth/sessions/s2': reply(500, { error: 'Internal Server Error' }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out Safari on iPhone' }));
    expect(
      await screen.findByText(
        'Could not sign out that browser. The server ran into a problem (error 500). Try again in a moment. If it keeps happening, check the server logs.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Safari on iPhone')).toBeInTheDocument();
  });

  it('signs out everywhere: clears the cache first, then replaces the page (FLW-07)', async () => {
    const { client, fetch } = setup({ 'DELETE /api/v1/auth/sessions': { success: true } });
    await rowOf('Safari on iPhone');
    client.setQueryData(['keys'], [{ id: 'k1' }]);
    let cachedAtNavigation: unknown = 'not called';
    vi.mocked(replacePage).mockImplementation(() => {
      cachedAtNavigation = client.getQueryData(['keys']);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign out everywhere?' });
    expect(dialog).toHaveTextContent('this one included. API keys keep working.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(replacePage).toHaveBeenCalledWith('/studio'));
    expect(cachedAtNavigation).toBeUndefined();
    expect(
      fetch.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/auth/sessions'),
    ).toBe(true);
  });

  it('treats a 401 from sign out everywhere as signed out', async () => {
    setup({ 'DELETE /api/v1/auth/sessions': reply(401, { error: 'Not signed in' }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(replacePage).toHaveBeenCalledWith('/studio'));
  });

  it('stays and explains in the dialog when sign out everywhere fails', async () => {
    setup({ 'DELETE /api/v1/auth/sessions': reply(500, { error: 'Internal Server Error' }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    expect(await within(dialog).findByText('Could not sign out everywhere')).toBeInTheDocument();
    expect(replacePage).not.toHaveBeenCalled();
  });

  it('says what failed with Try again when the list does not load', async () => {
    let fail = true;
    setup({
      '/api/v1/auth/sessions': () =>
        fail ? reply(500, { error: 'Internal Server Error' }) : { data: rows },
    });
    expect(await screen.findByText(/Could not load your signed-in browsers/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Safari on iPhone')).toBeInTheDocument();
  });
});
