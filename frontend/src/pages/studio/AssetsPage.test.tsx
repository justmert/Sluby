import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
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

const page = (data: unknown[], total = data.length, pageNo = 1) => ({
  data,
  total,
  page: pageNo,
  limit: 24,
  next_cursor: null,
});

const bunny = asset('a1', 'Big Buck Bunny');
const sintel = asset('bad', 'Sintel');
const failedOne = asset('f1', 'Broken upload', 'failed');

/** The library as a tiny server: filters by status and search, 24 per page. */
function library(all = [bunny, sintel, failedOne]) {
  let rows = [...all];
  const server = jsonFetch({
    '/api/v1/assets': ({ query }: RecordedCall) => {
      const status = query.get('status');
      const search = query.get('search');
      const n = Number(query.get('page') ?? 1);
      const hits = rows.filter(
        (a) => (!status || a.status === status) && (!search || a.title.includes(search)),
      );
      return page(hits.slice((n - 1) * 24, n * 24), hits.length, n);
    },
    'DELETE /api/v1/assets/a1': () => {
      rows = rows.filter((a) => a.id !== 'a1');
      return { success: true };
    },
    'DELETE /api/v1/assets/f1': () => {
      rows = rows.filter((a) => a.id !== 'f1');
      return { success: true };
    },
    'DELETE /api/v1/assets/bad': reply(409, { error: 'Asset is locked' }),
    'DELETE /api/v1/assets/gone': reply(404, { error: 'Video asset not found' }),
  });
  vi.stubGlobal('fetch', vi.fn(server));
  return server;
}

const listCalls = (server: ReturnType<typeof library>) =>
  server.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/assets');
const deletes = (server: ReturnType<typeof library>) =>
  server.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('/').pop());

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function renderLibrary(route = '/studio/assets') {
  return renderPage(
    <Routes>
      <Route
        path="/studio/assets"
        element={
          <>
            <AssetsPage />
            <Where />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('AssetsPage', () => {
  it('drives search, filter and sort from the url into the api', async () => {
    const server = library([bunny]);
    renderLibrary('/studio/assets?q=Bunny&status=ready&tier=private&sort=title:asc');
    await screen.findByText('Big Buck Bunny');

    const params = listCalls(server)[0].query;
    expect(params.get('search')).toBe('Bunny');
    expect(params.get('status')).toBe('ready');
    expect(params.get('access_tier')).toBe('private');
    expect(params.get('sort')).toBe('title');
    expect(params.get('order')).toBe('asc');
  });

  it('searches on the server as you type', async () => {
    const server = library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');

    await userEvent.type(screen.getByRole('textbox', { name: 'Search assets' }), 'nothing');

    await waitFor(() => expect(listCalls(server).at(-1)!.query.get('search')).toBe('nothing'));
    expect(await screen.findByText('No matching videos')).toBeInTheDocument();
  });

  it('says "1 video" for one', async () => {
    library([bunny]);
    renderLibrary();
    expect(await screen.findByText('1 video')).toBeInTheDocument();
  });

  it('bulk deletes, names what failed by title, and keeps it selected', async () => {
    const server = library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Big Buck Bunny' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 2 videos?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Could not delete "Sintel": Asset is locked'),
    ).toBeInTheDocument();
    expect(screen.getByText('Deleting 1 video from Sia')).toBeInTheDocument();
    expect(deletes(server).sort()).toEqual(['a1', 'bad']);
    await waitFor(() => expect(screen.queryByText('Big Buck Bunny')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Select Sintel' })).toBeChecked();
    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
  });

  it('treats an asset that is already gone as deleted', async () => {
    library([asset('gone', 'Already deleted')]);
    renderLibrary();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Already deleted' }));
    await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('Deleting 1 video from Sia')).toBeInTheDocument();
    expect(screen.queryByText(/Could not delete/)).not.toBeInTheDocument();
  });

  it('clears the selection when the filter changes, so hidden rows are never deleted', async () => {
    const server = library();
    renderLibrary('/studio/assets?status=failed');
    await screen.findByText('Broken upload');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    expect(screen.getByText('1 of 1 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Ready' }));
    await screen.findByText('Big Buck Bunny');

    expect(screen.queryByRole('button', { name: /delete selected/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all on this page' })).not.toBeChecked();
    expect(deletes(server)).toEqual([]);
  });

  it('selects all in the grid view and shows a partial selection as mixed', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    const all = screen.getByRole('checkbox', { name: 'Select all on this page' });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    expect(all).toHaveAttribute('aria-checked', 'mixed');
    await userEvent.click(all);
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Big Buck Bunny' })).toBeChecked();
  });

  it('goes back to the last page when the page is past the end', async () => {
    library();
    renderLibrary('/studio/assets?page=5');
    await screen.findByText('Big Buck Bunny');
    expect(screen.queryByText('No videos yet')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^$/);
  });

  it('shows the pager on a later page and moves between pages', async () => {
    const many = Array.from({ length: 30 }, (_, i) => asset(`id-${i}`, `Video ${i}`));
    const server = library(many);
    renderLibrary();
    await screen.findByText('Video 0');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText('Video 29')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(listCalls(server).at(-1)!.query.get('page')).toBe('2');
  });

  it('switches to the list view with a select-all header', async () => {
    library();
    renderLibrary('/studio/assets?view=list');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
  });

  it('shows full titles on hover', async () => {
    library([asset('a1', 'A very long title that the card truncates')]);
    renderLibrary();
    const title = await screen.findByText('A very long title that the card truncates');
    expect(title).toHaveAttribute('title', 'A very long title that the card truncates');
  });
});
