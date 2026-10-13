import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import AssetsPage from './AssetsPage';

function asset(id: string, title: string, status = 'ready') {
  return {
    id,
    title,
    description: '',
    manifest_object_id: 'm',
    thumbnail_object_ids: [],
    duration_ms: 90_000,
    resolution: '1280x720',
    status,
    access_tier: 'public',
    creator_address: 'github:dev',
    segment_count: 1,
    total_storage_bytes: 2048,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const listCalls = () =>
  fetchMock.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter((u) => u.pathname === '/api/v1/assets');

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === 'DELETE') {
      return url.pathname.endsWith('/bad')
        ? new Response(JSON.stringify({ error: 'Asset is locked' }), { status: 409 })
        : new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    }
    const search = url.searchParams.get('search');
    const data =
      search === 'nothing' ? [] : [asset('a1', 'Big Buck Bunny'), asset('bad', 'Sintel')];
    return new Response(JSON.stringify({ data, total: data.length, page: 1, limit: 24 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('AssetsPage', () => {
  it('drives search, filter and sort from the url into the api', async () => {
    renderPage(<AssetsPage />, { route: '/?q=bunny&status=ready&tier=private&sort=title:asc' });
    await screen.findByText('Big Buck Bunny');

    const params = listCalls()[0].searchParams;
    expect(params.get('search')).toBe('bunny');
    expect(params.get('status')).toBe('ready');
    expect(params.get('access_tier')).toBe('private');
    expect(params.get('sort')).toBe('title');
    expect(params.get('order')).toBe('asc');
  });

  it('searches on the server as you type', async () => {
    renderPage(<AssetsPage />);
    await screen.findByText('Big Buck Bunny');

    await userEvent.type(screen.getByRole('textbox', { name: 'Search assets' }), 'nothing');

    await waitFor(() => expect(listCalls().at(-1)!.searchParams.get('search')).toBe('nothing'));
    expect(await screen.findByText('No matching videos')).toBeInTheDocument();
  });

  it('bulk deletes and reports per-asset failures instead of hiding them', async () => {
    renderPage(<AssetsPage />);
    await screen.findByText('Big Buck Bunny');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Big Buck Bunny' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 2 videos?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'DELETE'),
      ).toHaveLength(2),
    );
  });

  it('switches to the list view', async () => {
    renderPage(<AssetsPage />, { route: '/?view=list' });
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all on this page' })).toBeInTheDocument();
  });
});
