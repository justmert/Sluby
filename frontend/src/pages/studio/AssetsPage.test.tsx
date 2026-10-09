import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import AssetsPage from './AssetsPage';

// the real player needs MSE and hls.js; the preview only has to mount one
vi.mock('@sluby/player', () => ({
  SlubyPlayer: ({ assetId }: { assetId: string }) => (
    <video data-testid="player" data-asset={assetId} />
  ),
}));

const OLD = '2026-10-01T00:00:00Z';

function asset(id: string, title: string, status = 'ready', extra: Record<string, unknown> = {}) {
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
    created_at: OLD,
    updated_at: OLD,
    ...extra,
  };
}
type Row = ReturnType<typeof asset>;

const bunny = asset('a1', 'Big Buck Bunny');
const sintel = asset('bad', 'Sintel');
const failedOne = asset('f1', 'Broken upload', 'failed');

const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    asset(`id-${String(i).padStart(3, '0')}`, `Item ${String(i).padStart(3, '0')}`),
  );

const stats = (rows: Row[]) => {
  const by = { created: 0, uploading: 0, processing: 0, ready: 0, failed: 0 };
  for (const r of rows) by[r.status as keyof typeof by]++;
  return {
    total: rows.length,
    by_status: by,
    stored_bytes: 0,
    ready_duration_ms: 0,
    object_count: 0,
  };
};

/**
 * The library as a small server: filters by status, access and search, 24
 * per page (100 for the walks), deletes and access edits. Deletes answer
 * after `deleteDelay`, as a real server does.
 */
function library(all: Row[] = [bunny, sintel, failedOne], { deleteDelay = 0 } = {}) {
  let rows = [...all];
  const server = jsonFetch({
    '/api/v1/assets': ({ query }: RecordedCall) => {
      const status = query.get('status');
      const tier = query.get('access_tier');
      const search = query.get('search');
      const n = Number(query.get('page') ?? 1);
      const limit = Number(query.get('limit') ?? 24);
      const hits = rows.filter(
        (a) =>
          (!status || a.status === status) &&
          (!tier || a.access_tier === tier) &&
          (!search || a.title.includes(search)),
      );
      return {
        data: hits.slice((n - 1) * limit, n * limit),
        total: hits.length,
        page: n,
        limit,
        next_cursor: null,
        has_more: n * limit < hits.length,
      };
    },
    '/api/v1/stats': () => stats(rows),
    'DELETE /api/v1/assets/bad': reply(409, { error: 'Asset is locked' }),
    'DELETE /api/v1/assets/gone': reply(404, { error: 'Video asset not found' }),
  });
  const routed = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    const id = url.pathname.split('/').pop()!;
    const method = init?.method ?? 'GET';
    if (method === 'DELETE' && id !== 'bad' && id !== 'gone') {
      server.calls.push({ method, path: url.pathname, query: url.searchParams, body: undefined });
      if (deleteDelay) await new Promise((r) => setTimeout(r, deleteDelay));
      rows = rows.filter((a) => a.id !== id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'PATCH') {
      const body = JSON.parse(String(init?.body));
      server.calls.push({ method, path: url.pathname, query: url.searchParams, body });
      rows = rows.map((a) => (a.id === id ? { ...a, access_tier: body.access_tier } : a));
      return new Response(JSON.stringify(rows.find((a) => a.id === id)), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return server(input, init);
  };
  vi.stubGlobal('fetch', vi.fn(routed));
  return server;
}

const listCalls = (server: ReturnType<typeof library>) =>
  server.calls.filter(
    (c) => c.method === 'GET' && c.path === '/api/v1/assets' && c.query.get('limit') === '24',
  );
const deletes = (server: ReturnType<typeof library>) =>
  server.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('/').pop());

function Where() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="where">{location.search}</output>
      <button type="button" onClick={() => navigate('/studio/videos?q=Bunny')}>
        open a bunny search
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        history back
      </button>
    </>
  );
}

function renderLibrary(route = '/studio/videos') {
  return renderPage(
    <Routes>
      <Route path="/" element={<p>start page</p>} />
      <Route path="/studio/videos/:id" element={<p>video page</p>} />
      <Route
        path="/studio/videos"
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

const where = () => screen.getByTestId('where').textContent;
// the table header's box; the toolbar's copy shows only in the grid and the
// phone cards, by a container query jsdom does not run
const selectAll = () =>
  within(screen.queryByRole('table') ?? document.body).getAllByRole('checkbox', {
    name: 'Select all on this page',
  })[0];
const emptyTitle = (text: string) =>
  screen.findByText(text, { selector: '[data-slot=empty-title]' });
const search = () => screen.getByRole('textbox', { name: 'Search videos' });
const status = () =>
  screen.getByText((_, el) => el?.getAttribute('role') === 'status' && el.tagName === 'P');

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('AssetsPage: the table and its url', () => {
  it('shows the table by default with the video, status, access and facts', async () => {
    library([bunny, { ...sintel, access_tier: 'private' }]);
    renderLibrary();
    await screen.findByText('Sintel');
    const table = screen.getByRole('table', { name: 'Videos' });
    for (const name of ['Video', 'Status', 'Access', 'Duration', 'Size', 'Plays', 'Created']) {
      expect(
        within(table).getByRole('columnheader', { name: new RegExp(name) }),
      ).toBeInTheDocument();
    }
    const row = within(table).getByText('Sintel').closest('tr')!;
    expect(within(row).getAllByText('Private').length).toBeGreaterThan(0);
    expect(within(table).getByText('Big Buck Bunny').closest('tr')).toHaveTextContent('Public');
    expect(await screen.findByText('2 videos')).toBeInTheDocument();
  });

  it('drives search, filter and sort from the url into the api', async () => {
    const server = library([bunny]);
    renderLibrary('/studio/videos?q=Bunny&status=ready&tier=private&sort=title:asc');
    await waitFor(() => expect(listCalls(server).length).toBeGreaterThan(0));
    const params = listCalls(server)[0].query;
    expect(params.get('search')).toBe('Bunny');
    expect(params.get('status')).toBe('ready');
    expect(params.get('access_tier')).toBe('private');
    expect(params.get('sort')).toBe('title');
    expect(params.get('order')).toBe('asc');
  });

  it('sorts by a header click and pushes it to history', async () => {
    const server = library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('button', { name: /^Size/ }));
    await waitFor(() => expect(where()).toBe('?sort=size%3Adesc'));
    expect(listCalls(server).at(-1)!.query.get('sort')).toBe('size');
    expect(screen.getByRole('columnheader', { name: /Size/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await userEvent.click(screen.getByRole('button', { name: 'history back' }));
    await waitFor(() => expect(where()).toBe(''));
  });

  it('drops values the api would refuse with replace, and loads the library (FLW-24)', async () => {
    const server = library(many(3));
    renderLibrary('/studio/videos?status=bogus&sort=nope&tier=x&page=0&view=huge&upload=0');
    expect(await screen.findByText('Item 000')).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe('?upload=0'));
    expect(listCalls(server).every((c) => !c.query.has('status'))).toBe(true);
    expect(listCalls(server).every((c) => c.query.get('sort') === 'created_at')).toBe(true);
    // replace: Back leaves for the page before, not to the bad url
    await userEvent.click(screen.getByRole('button', { name: 'history back' }));
    await waitFor(() => expect(where()).toBe('?upload=0'));
  });

  it('says the filters are not valid on a 400 and offers only Clear filters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({
          '/api/v1/assets': reply(400, { error: 'search is too long' }),
          '/api/v1/stats': stats([]),
        }),
      ),
    );
    renderLibrary('/studio/videos?q=x');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Could not load your videos' }),
    ).toBeInTheDocument();
    expect(screen.getByText('These filters are not valid.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows the page state with one heading when the library does not load, and retries', async () => {
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({
          '/api/v1/assets': () =>
            fail
              ? reply(503, { error: 'Database unavailable' })
              : { data: [bunny], total: 1, page: 1, limit: 24, next_cursor: null },
          '/api/v1/stats': stats([bunny]),
        }),
      ),
    );
    renderLibrary('/studio/videos?status=ready');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Could not load your videos' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // the sentence comes from the error map, the raw text only under details
    expect(screen.queryByText('Database unavailable')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Big Buck Bunny')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Videos' })).toBeInTheDocument();
  });

  it('keeps the rows on screen when a later poll fails', async () => {
    let fail = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({
          '/api/v1/assets': () =>
            fail
              ? reply(503, { error: 'Database unavailable' })
              : { data: [bunny], total: 1, page: 1, limit: 24, next_cursor: null },
          '/api/v1/stats': stats([bunny]),
        }),
      ),
    );
    const { client } = renderLibrary();
    await screen.findByText('Big Buck Bunny');
    fail = true;
    await act(() => client.refetchQueries({ queryKey: ['assets', 'list'] }));
    expect(screen.getByText('Big Buck Bunny')).toBeInTheDocument();
    expect(screen.queryByText('Could not load your videos')).not.toBeInTheDocument();
  });

  it('remembers the grid view per browser and still reads the old list value', async () => {
    library();
    const first = renderLibrary();
    await screen.findByRole('table', { name: 'Videos' });
    await userEvent.click(screen.getByRole('radio', { name: 'Grid view' }));
    expect(await screen.findByRole('list', { name: 'Videos' })).toBeInTheDocument();
    expect(where()).toBe('?view=grid');
    first.unmount();

    renderLibrary();
    expect(await screen.findByRole('list', { name: 'Videos' })).toBeInTheDocument();
    first.client.clear();
  });

  it('reads view=list as the table', async () => {
    localStorage.setItem('sluby:videos-view', 'grid');
    library();
    renderLibrary('/studio/videos?view=list');
    expect(await screen.findByRole('table', { name: 'Videos' })).toBeInTheDocument();
  });

  it('says how many videos and how many are processing', async () => {
    library([bunny, asset('p1', 'Cooking', 'processing')]);
    vi.mocked(fetch).mockImplementation(
      ((base) => async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/processing')
          ? new Response(
              JSON.stringify({
                id: 'j',
                status: 'processing',
                stage: 'transcode',
                progress_percent: 40,
                retry_count: 0,
                error_message: null,
                started_at: null,
                completed_at: null,
                created_at: OLD,
                logs: [],
              }),
              { headers: { 'content-type': 'application/json' } },
            )
          : base(input, init))(vi.mocked(fetch).getMockImplementation()!),
    );
    renderLibrary();
    expect(await screen.findByText('2 videos, 1 processing')).toBeInTheDocument();
    expect(await screen.findByText('Transcoding, 40%')).toBeInTheDocument();
  });

  it('wraps long titles to two lines with their own direction (A11Y-26, A11Y-27)', async () => {
    library([asset('a1', 'A very long title that the table wraps instead of cutting off')]);
    renderLibrary();
    const title = await screen.findByRole('link', {
      name: 'A very long title that the table wraps instead of cutting off',
    });
    expect(title).toHaveAttribute('dir', 'auto');
    expect(title).toHaveClass('line-clamp-2', 'wrap-anywhere');
  });

  it('does not request thumbnails of private videos and marks them private', async () => {
    library([
      asset('p1', 'Secret', 'ready', { access_tier: 'private', thumbnail_object_ids: ['t1'] }),
    ]);
    renderLibrary();
    await screen.findByText('Secret');
    expect(document.querySelector('img[src*="/v1/objects/"]')).toBeNull();
    expect(screen.getByLabelText('Private video, no preview')).toBeInTheDocument();
  });

  it('shows skeleton rows while loading, and card skeletons in the grid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const { unmount } = renderLibrary();
    const table = await screen.findByRole('table', { name: 'Videos' });
    expect(table).toHaveAttribute('aria-busy', 'true');
    unmount();
    renderLibrary('/studio/videos?view=grid');
    const skeletons = await screen.findAllByTestId('asset-card-skeleton');
    expect(skeletons[0].querySelector('.aspect-video')).not.toBeNull();
  });
});

describe('AssetsPage: search and history', () => {
  it('searches on the server as you type and announces the result', async () => {
    const server = library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.type(search(), 'nothing');
    await waitFor(() => expect(listCalls(server).at(-1)!.query.get('search')).toBe('nothing'));
    expect(await emptyTitle('No matching videos')).toBeInTheDocument();
    await waitFor(() => expect(status()).toHaveTextContent('No matching videos'));
  });

  it('makes one history entry per typed search, so Back returns to the full list (FLW-25)', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.type(search(), 'Sin');
    await waitFor(() => expect(where()).toBe('?q=Sin'));
    await new Promise((r) => setTimeout(r, 350));
    await userEvent.type(search(), 'tel');
    await waitFor(() => expect(where()).toBe('?q=Sintel'));
    await userEvent.click(screen.getByRole('button', { name: 'history back' }));
    await waitFor(() => expect(where()).toBe(''));
    expect(search()).toHaveValue('');
    expect(await screen.findByText('Big Buck Bunny')).toBeInTheDocument();
  });

  it('pushes paging to history, so Back goes to the previous page (FLW-25)', async () => {
    library(many(30));
    renderLibrary();
    await screen.findByText('Item 000');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText('Item 029')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'history back' }));
    expect(await screen.findByText('Item 000')).toBeInTheDocument();
    expect(screen.queryByText('start page')).not.toBeInTheDocument();
  });

  it('brings the top of the results into view on a page change (FLW-32)', async () => {
    library(many(30));
    renderLibrary();
    await screen.findByText('Item 000');
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('puts the search box back in step with the url on back and forward', async () => {
    library();
    renderLibrary('/studio/videos?q=Sintel');
    await screen.findByText('Sintel');
    expect(search()).toHaveValue('Sintel');
    await userEvent.click(screen.getByRole('button', { name: 'open a bunny search' }));
    await waitFor(() => expect(search()).toHaveValue('Bunny'));
    await userEvent.click(screen.getByRole('button', { name: 'history back' }));
    await waitFor(() => expect(search()).toHaveValue('Sintel'));
    await new Promise((r) => setTimeout(r, 400));
    expect(where()).toBe('?q=Sintel');
  });

  it('says it is searching while the next results are on their way', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.type(search(), 'S');
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Searching' })).not.toBeInTheDocument(),
    );
  });

  it('focuses the search on "/" and lets go of a selection on escape', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.keyboard('/');
    expect(search()).toHaveFocus();
    await userEvent.type(search(), 'abc');
    await userEvent.keyboard('{Escape}');
    expect(search()).toHaveValue('');
    search().blur();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('checkbox', { name: 'Select Sintel' })).not.toBeChecked();
  });

  it('shows "Nothing on this page" for a link past the end, with a way back', async () => {
    library();
    renderLibrary('/studio/videos?page=5');
    expect(await screen.findByText('Nothing on this page')).toBeInTheDocument();
    expect(screen.getByText('Your library has 3 videos on 1 page.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to page 1' }));
    expect(await screen.findByText('Big Buck Bunny')).toBeInTheDocument();
    expect(where()).toBe('');
  });

  it('counts uploads that never started and filters to them', async () => {
    const stale = asset('s1', 'Abandoned', 'created', { created_at: OLD });
    library([bunny, stale]);
    renderLibrary();
    expect(await screen.findByText('1 upload never started.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show them' }));
    await waitFor(() => expect(where()).toBe('?status=created'));
    expect(await screen.findByText('Upload interrupted')).toBeInTheDocument();
  });

  it('shows the empty library with an upload action, and the no-match state with Clear filters', async () => {
    library([]);
    const { unmount } = renderLibrary();
    expect(await emptyTitle('No videos yet')).toBeInTheDocument();
    expect(
      screen.getByText('Upload a video and it will be ready to stream in a few minutes.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Upload video' })[1]);
    await waitFor(() => expect(where()).toBe('?upload=1'));
    unmount();
    library();
    renderLibrary('/studio/videos?q=zzz');
    expect(await emptyTitle('No matching videos')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('Big Buck Bunny')).toBeInTheDocument();
  });

  it('opens the upload sheet with files dropped anywhere on the page', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    const files = [
      new File(['a'], 'a.mp4', { type: 'video/mp4' }),
      new File(['b'], 'b.mp4', { type: 'video/mp4' }),
    ];
    const dataTransfer = { types: ['Files'], files, dropEffect: 'none' };
    fireEvent.dragEnter(document.body, { dataTransfer });
    expect(await screen.findByText('Drop to upload')).toBeInTheDocument();
    fireEvent.drop(document.body, { dataTransfer });
    await waitFor(() => expect(where()).toBe('?upload=1'));
    expect(screen.queryByText('Drop to upload')).not.toBeInTheDocument();
    const { takePendingFiles } = await import('@/lib/upload-sheet');
    expect(takePendingFiles().map((f) => f.name)).toEqual(['a.mp4', 'b.mp4']);
  });
});

describe('AssetsPage: selection and bulk actions', () => {
  it('bulk deletes, names what failed by title, and keeps it selected', async () => {
    const server = library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Big Buck Bunny' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 2 videos?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'They are removed from your library now and from Sia in the background. This cannot be undone.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/^Could not delete “Sintel”\. /)).toBeInTheDocument();
    expect(screen.getByText('Video deleted')).toBeInTheDocument();
    expect(deletes(server).sort()).toEqual(['a1', 'bad']);
    await waitFor(() => expect(screen.queryByText('Big Buck Bunny')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Select Sintel' })).toBeChecked();
    expect(within(screen.getByRole('toolbar')).getByText(/of 2/)).toBeInTheDocument();
  });

  it('treats a video that is already gone as deleted', async () => {
    library([asset('gone', 'Already deleted')]);
    renderLibrary();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Already deleted' }));
    await userEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete' }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('Video deleted')).toBeInTheDocument();
    expect(screen.queryByText(/Could not delete/)).not.toBeInTheDocument();
  });

  it('focuses the search after a bulk delete, since the bar went away (A11Y-15)', async () => {
    library([bunny, failedOne]);
    renderLibrary();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Big Buck Bunny' }));
    await userEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete' }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(search()).toHaveFocus());
  });

  it('shows the next videos on page 1 after deleting all of page 1 of 3 (FLW-03)', async () => {
    library(many(70), { deleteDelay: 60 });
    renderLibrary();
    await screen.findByText('Item 000');
    await userEvent.click(selectAll());
    await userEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete' }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('Item 024', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(where()).toBe('');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('moves to the last page that has rows after emptying the last page', async () => {
    library(many(30), { deleteDelay: 30 });
    renderLibrary('/studio/videos?page=2');
    await screen.findByText('Item 024');
    await userEvent.click(selectAll());
    await userEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete' }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(where()).toBe(''), { timeout: 5000 });
    expect(await screen.findByText('Item 000')).toBeInTheDocument();
    expect(screen.queryByText('Nothing on this page')).not.toBeInTheDocument();
  });

  it('takes deleted rows off at once, before the server answers', async () => {
    let release!: () => void;
    const answered = new Promise<void>((r) => (release = r));
    const server = library();
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'DELETE') await answered;
      return base(input, init);
    });
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Big Buck Bunny' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete this video?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        '“Big Buck Bunny” is removed from your library now and from Sia in the background. This cannot be undone.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Big Buck Bunny')).not.toBeInTheDocument());
    expect(deletes(server)).toEqual([]);
    release();
    expect(await screen.findByText('Video deleted')).toBeInTheDocument();
  });

  it('puts a row back when its delete fails', async () => {
    library();
    renderLibrary();
    await screen.findByText('Sintel');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Sintel' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText(/^Could not delete “Sintel”\. /)).toBeInTheDocument();
    expect(screen.getByText('Sintel')).toBeInTheDocument();
  });

  it('keeps bulk deleted rows hidden when a list poll lands mid-delete with them still in it', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({
          // the server has not processed the deletes yet, so every poll still lists them
          '/api/v1/assets': {
            data: [bunny, sintel, failedOne],
            total: 3,
            page: 1,
            limit: 24,
            next_cursor: null,
          },
          '/api/v1/stats': stats([bunny, sintel, failedOne]),
          'DELETE /api/v1/assets/a1': async () => {
            await held;
            return { success: true };
          },
          'DELETE /api/v1/assets/f1': async () => {
            await held;
            return { success: true };
          },
        }),
      ),
    );
    const { client } = renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Big Buck Bunny' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Broken upload' }));
    await userEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete' }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(screen.queryByText('Big Buck Bunny')).not.toBeInTheDocument());
    await act(() => client.refetchQueries({ queryKey: ['assets', 'list'] }));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByText('Big Buck Bunny')).not.toBeInTheDocument();
    expect(screen.queryByText('Broken upload')).not.toBeInTheDocument();
    expect(screen.getByText('Sintel')).toBeInTheDocument();
    release();
    expect(await screen.findByText('2 videos deleted')).toBeInTheDocument();
  });

  it('clears the selection when the filter changes, so hidden rows are never deleted', async () => {
    const server = library();
    renderLibrary('/studio/videos?status=failed');
    await screen.findByText('Broken upload');
    await userEvent.click(selectAll());
    expect(screen.getByRole('toolbar', { name: 'Selected videos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Ready' }));
    await screen.findByText('Big Buck Bunny');
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected videos' })).not.toBeInTheDocument(),
    );
    expect(deletes(server)).toEqual([]);
  });

  it('selects all in the grid view, shows a partial selection as mixed, and selects ranges', async () => {
    library(many(6));
    const user = userEvent.setup();
    renderLibrary('/studio/videos?view=grid');
    await screen.findByText('Item 000');
    const all = selectAll();
    const box = (n: number) =>
      screen.getByRole('checkbox', { name: `Select Item ${String(n).padStart(3, '0')}` });
    await user.click(box(1));
    expect(all).toHaveAttribute('aria-checked', 'mixed');
    await user.keyboard('{Shift>}');
    await user.click(box(4));
    await user.keyboard('{/Shift}');
    expect([0, 1, 2, 3, 4, 5].map((n) => box(n).getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'true',
      'true',
      'true',
      'false',
    ]);
    await user.click(all);
    expect(within(screen.getByRole('toolbar')).getByText(/of 6/)).toBeInTheDocument();
  });

  it('announces the selection in an always-mounted region and Clear returns focus to select all', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    const region = status();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    expect(region).toHaveTextContent('1 selected');
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear' }));
    expect(region).toHaveTextContent('Selection cleared');
    // which copy is the visible one is a container query; jsdom sees both
    expect(document.activeElement).toHaveAccessibleName('Select all on this page');
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected videos' })).not.toBeInTheDocument(),
    );
  });

  it('puts the bulk bar right after the filters in the tab order (A11Y-15)', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    const table = screen.getByRole('table', { name: 'Videos' });
    expect(bar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--toast-lift')).toBe('4rem');
  });

  it('widens a full page to every result and acts on all of them (FLW-43)', async () => {
    const server = library(many(70));
    renderLibrary();
    await screen.findByText('Item 000');
    await userEvent.click(selectAll());
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    expect(within(bar).getByText('All 24 on this page are selected.')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Select all 70 results' }));
    expect(await within(bar).findByText('All 70 results are selected.')).toBeInTheDocument();
    // a selection across pages survives paging
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByText('Item 024');
    expect(screen.getByRole('checkbox', { name: 'Select Item 030' })).toBeChecked();
    await userEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 70 videos?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('70 videos deleted', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(deletes(server)).toHaveLength(70);
  });

  it('makes the selected videos private after a confirm, skipping ones already private', async () => {
    const server = library([
      bunny,
      sintel,
      asset('p1', 'Secret', 'ready', { access_tier: 'private' }),
    ]);
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(selectAll());
    await userEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Make private' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Make 2 videos private?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make private' }));
    expect(await screen.findByText('2 videos are now private')).toBeInTheDocument();
    const patches = server.calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => c.path).sort()).toEqual(['/api/v1/assets/a1', '/api/v1/assets/bad']);
    expect(
      patches.every((c) => (c.body as { access_tier: string }).access_tier === 'private'),
    ).toBe(true);
  });
});

describe('AssetsPage: row menu and preview', () => {
  it('offers the share actions only for ready videos, with icons', async () => {
    library([bunny, failedOne, { ...sintel, access_tier: 'private' }]);
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    const names = async (title: string) => {
      await userEvent.click(screen.getByRole('button', { name: `Actions for ${title}` }));
      const items = (await screen.findAllByRole('menuitem')).map((i) => {
        expect(i.querySelector('svg')).not.toBeNull();
        return i.textContent;
      });
      await userEvent.keyboard('{Escape}');
      return items;
    };
    expect(await names('Big Buck Bunny')).toEqual([
      'Open',
      'Preview',
      'Copy embed code',
      'Copy stream URL',
      'Copy video ID',
      'Delete',
    ]);
    expect(await names('Sintel')).toEqual([
      'Open',
      'Preview',
      'Copy embed code',
      'Copy video ID',
      'Delete',
    ]);
    expect(await names('Broken upload')).toEqual(['Open', 'Copy video ID', 'Delete']);
  });

  it('copies the video ID and the embed code', async () => {
    library([bunny]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Big Buck Bunny' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy video ID' }));
    expect(writeText).toHaveBeenLastCalledWith('a1');
    expect(await screen.findByText('Video ID copied')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Big Buck Bunny' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy embed code' }));
    expect(writeText.mock.lastCall![0]).toContain('<SlubyPlayer');
    expect(writeText.mock.lastCall![0]).toContain("'a1'");
    writeText.mockRejectedValueOnce(new Error('denied'));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Big Buck Bunny' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy video ID' }));
    expect(
      await screen.findByText('Could not copy. Your browser blocked the clipboard'),
    ).toBeInTheDocument();
  });

  it('previews a ready video in a sheet, steps with the arrow keys and returns focus', async () => {
    library([bunny, failedOne, sintel]);
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Big Buck Bunny' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Preview' }));
    const sheet = await screen.findByRole('dialog', { name: 'Big Buck Bunny' });
    expect(within(sheet).getByTestId('player')).toHaveAttribute('data-asset', 'a1');
    expect(within(sheet).getByRole('link', { name: 'Open video' })).toHaveAttribute(
      'href',
      '/studio/videos/a1',
    );
    expect(where()).toBe('?preview=a1');

    // the failed video is skipped: only ready ones play
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByRole('dialog', { name: 'Sintel' })).toBeInTheDocument();
    expect(where()).toBe('?preview=bad');
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Next video' }),
    ).toHaveAttribute('aria-disabled', 'true');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(where()).toBe('');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sintel' })).toHaveFocus());
  });

  it('opens the preview with Space on a focused title', async () => {
    library([bunny]);
    renderLibrary();
    const link = await screen.findByRole('link', { name: 'Big Buck Bunny' });
    link.focus();
    await userEvent.keyboard(' ');
    expect(await screen.findByRole('dialog', { name: 'Big Buck Bunny' })).toBeInTheDocument();
  });

  it('opens a video from the row menu', async () => {
    library([bunny]);
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Big Buck Bunny' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));
    expect(await screen.findByText('video page')).toBeInTheDocument();
  });
});
