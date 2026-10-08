import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import AssetsPage from './AssetsPage';

function asset(id: string, title: string, status = 'ready') {
  return {
    id,
    title,
    description: '',
    manifest_object_id: 'm',
    thumbnail_object_ids: [] as string[],
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
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="where">{location.search}</output>
      <button type="button" onClick={() => navigate('/studio/assets?q=Bunny')}>
        open a bunny search
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        history back
      </button>
    </>
  );
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

  it('keeps the delete dialog title while it closes instead of "Delete undefined videos?"', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Big Buck Bunny' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    const dialog = await screen.findByRole('alertdialog');

    // every text the page showed on the way out, including frames that only
    // live until the dialog unmounts
    const seen: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const node = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target;
        if (node instanceof Element) seen.push(node.textContent ?? '');
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    observer.disconnect();

    expect(seen.join('\n')).not.toContain('undefined');
  });

  it('gives the card checkbox a visible backing and a 24px target', async () => {
    library([bunny]);
    renderLibrary();
    const box = await screen.findByRole('checkbox', { name: 'Select Big Buck Bunny' });
    const target = box.closest('[data-slot="select-target"]');
    expect(target).not.toBeNull();
    expect(target!.className).toMatch(/\bsize-(6|7|8|9|10)\b/);
    expect(target!.className).toMatch(/bg-background\b/);
  });

  it('does not request thumbnails of private assets and marks them private', async () => {
    library([{ ...asset('p1', 'Secret'), access_tier: 'private', thumbnail_object_ids: ['t1'] }]);
    renderLibrary();
    await screen.findByText('Secret');
    expect(document.querySelector('img[src*="/v1/objects/"]')).toBeNull();
    expect(screen.getByLabelText('Private video, no preview')).toBeInTheDocument();
  });

  it('shows card shaped skeletons with a 16:9 thumb while loading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderLibrary();
    const skeletons = await screen.findAllByTestId('asset-card-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons[0].querySelector('.aspect-video')).not.toBeNull();
  });

  it('takes deleted cards off at once, before the server answers', async () => {
    let release!: () => void;
    const server = library();
    const answered = new Promise<void>((r) => (release = r));
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'DELETE') await answered;
      return base(input, init);
    });
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Big Buck Bunny' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(screen.queryByText('Big Buck Bunny')).not.toBeInTheDocument());
    // the delete is still waiting on the server
    expect(deletes(server)).toEqual([]);
    expect(screen.getByText('2 videos')).toBeInTheDocument();
    release();
    expect(await screen.findByText('Deleting 1 video from Sia')).toBeInTheDocument();
  });

  it('puts a card back when its delete fails', async () => {
    library();
    renderLibrary();
    await screen.findByText('Sintel');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Sintel' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(
      await screen.findByText('Could not delete "Sintel": Asset is locked'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sintel')).toBeInTheDocument();
    expect(screen.getByText('3 videos')).toBeInTheDocument();
  });

  it('shows the bulk actions only once something is selected', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    expect(screen.queryByRole('toolbar', { name: 'Selected videos' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    expect(within(bar).getByText('1 of 3 selected')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected videos' })).not.toBeInTheDocument(),
    );
  });

  it('focuses the search on "/" and lets go of a selection on escape', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    const search = screen.getByRole('textbox', { name: 'Search assets' });

    await userEvent.keyboard('/');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
    await userEvent.type(search, 'abc');
    await userEvent.keyboard('{Escape}');
    expect(search).toHaveValue('');

    search.blur();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('checkbox', { name: 'Select Sintel' })).not.toBeChecked();
  });

  it('puts the search box back in step with the url on back and forward', async () => {
    library();
    renderLibrary('/studio/assets?q=Sintel');
    await screen.findByText('Sintel');
    const search = screen.getByRole('textbox', { name: 'Search assets' });
    expect(search).toHaveValue('Sintel');

    await userEvent.click(screen.getByRole('button', { name: 'open a bunny search' }));
    await waitFor(() => expect(search).toHaveValue('Bunny'));
    await userEvent.click(screen.getByRole('button', { name: 'history back' }));
    await waitFor(() => expect(search).toHaveValue('Sintel'));
    // and the debounced box does not push its old value back over the url
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByTestId('where')).toHaveTextContent('?q=Sintel');
  });

  it('says it is searching while the next results are on their way', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.type(screen.getByRole('textbox', { name: 'Search assets' }), 'S');
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Searching' })).not.toBeInTheDocument(),
    );
  });

  it('shows the shared page state with one heading when the library does not load, and retries', async () => {
    let fail = true;
    const server = jsonFetch({
      '/api/v1/assets': () =>
        fail ? reply(503, { error: 'Database unavailable' }) : page([bunny]),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    renderLibrary('/studio/assets?status=ready');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Could not load assets' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Big Buck Bunny')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Assets' })).toBeInTheDocument();
  });

  it('keeps the rows on screen when a later poll fails', async () => {
    let fail = false;
    const server = jsonFetch({
      '/api/v1/assets': () =>
        fail ? reply(503, { error: 'Database unavailable' }) : page([bunny]),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { client } = renderLibrary();
    await screen.findByText('Big Buck Bunny');
    fail = true;
    await act(() => client.refetchQueries({ queryKey: ['assets', 'list'] }));
    await waitFor(() =>
      expect(client.getQueryCache().findAll({ queryKey: ['assets', 'list'] })[0].state.status).toBe(
        'error',
      ),
    );
    expect(screen.getByText('Big Buck Bunny')).toBeInTheDocument();
    expect(screen.queryByText('Could not load assets')).not.toBeInTheDocument();
  });
});
