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

const failedJob = {
  id: 'job',
  status: 'failed',
  stage: 'transcode',
  progress_percent: 30,
  retry_count: 1,
  error_message: 'ffmpeg exited with code 1',
  started_at: OLD,
  completed_at: OLD,
  created_at: OLD,
  logs: [],
  retryable: true,
};

/** Answers the per-video calls rows and the preview make: the job and the playback IDs. */
const perVideo =
  (base: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (/^\/api\/v1\/assets\/[^/]+\/processing$/.test(path)) return json(failedJob);
    if (/^\/api\/v1\/assets\/[^/]+\/playback-ids$/.test(path)) return json({ data: [] });
    return base(input, init);
  };

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
  vi.stubGlobal('fetch', vi.fn(perVideo(routed)));
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
      <Route path="/studio/videos/upload" element={<p>upload page</p>} />
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
const search = () => screen.getByRole('searchbox', { name: 'Search videos' });
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
    for (const name of ['Video', 'Status', 'Access', 'Length', 'Size', 'Plays', 'Uploaded']) {
      expect(
        within(table).getByRole('columnheader', { name: new RegExp(name) }),
      ).toBeInTheDocument();
    }
    const row = within(table).getByText('Sintel').closest('tr')!;
    expect(within(row).getAllByText('Private').length).toBeGreaterThan(0);
    expect(within(table).getByText('Big Buck Bunny').closest('tr')).toHaveTextContent('Public');
    expect(
      await screen.findByText('2 videos. Drop files anywhere on this page to upload.'),
    ).toBeInTheDocument();
    // the board's toolbar: search, the two labelled selects and the view switch
    expect(screen.getByRole('searchbox', { name: 'Search videos' })).toHaveAttribute(
      'placeholder',
      'Search by title or ID',
    );
    expect(screen.getByText('Status', { selector: 'label' })).toContainElement(
      screen.getByRole('combobox', { name: 'Filter by status' }),
    );
    expect(screen.getByText('Access', { selector: 'label' })).toContainElement(
      screen.getByRole('combobox', { name: 'Filter by access' }),
    );
    expect(
      within(screen.getByRole('radiogroup', { name: 'View' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Table', 'Grid']);
    // the pager lives in the table's card, with its range
    const pager = screen.getByRole('navigation', { name: 'Pages' });
    expect(table.closest('.rounded-xl')).toContainElement(pager);
    expect(pager).toHaveTextContent('1 to 2 of 2');
    expect(within(pager).getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(within(pager).getByRole('button', { name: 'Next' })).toBeDisabled();
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
    await userEvent.click(screen.getByRole('radio', { name: 'Grid' }));
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
    expect(
      await screen.findByText(
        '2 videos, 1 processing. Drop files anywhere on this page to upload.',
      ),
    ).toBeInTheDocument();
    // the chip names the stage and pulses; the bar under the title says how far
    const row = screen.getByRole('link', { name: 'Cooking' }).closest('tr')!;
    expect(await within(row).findByText('Transcoding')).toBeInTheDocument();
    expect(row.querySelector('[data-slot="status-dot"]')).not.toBeNull();
    expect(within(row).getByText('40%')).toBeInTheDocument();
    expect(within(row).getByRole('progressbar', { name: 'Cooking, Transcoding' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
  });

  it('cuts a long title to one line with its own direction, the whole title on hover (A11Y-26)', async () => {
    const long = 'A very long title that the table cuts off with an ellipsis like the board';
    library([asset('a1', long)]);
    renderLibrary();
    const title = await screen.findByRole('link', { name: long });
    expect(title).toHaveAttribute('dir', 'auto');
    expect(title).toHaveAttribute('title', long);
    expect(title).toHaveClass('truncate');
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

  it('goes back to the table on Back after switching to the grid', async () => {
    library();
    renderLibrary();
    await screen.findByRole('table', { name: 'Videos' });
    await userEvent.click(screen.getByRole('radio', { name: 'Grid' }));
    expect(await screen.findByRole('list', { name: 'Videos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'history back' }));
    expect(await screen.findByRole('table', { name: 'Videos' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked();
  });

  it('shows no pager and no page past the end for a link to an empty result', async () => {
    library([]);
    renderLibrary('/studio/videos?page=3&status=ready');
    expect(await emptyTitle('No matching videos')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Page 3 of/)).not.toBeInTheDocument();
    await waitFor(() => expect(where()).toBe('?status=ready'));
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

  it('says it under the videos, so the line arriving never pushes the table down', async () => {
    library([bunny, asset('s1', 'Abandoned', 'created', { created_at: OLD })]);
    renderLibrary();
    const line = await screen.findByText('1 upload never started.');
    const table = screen.getByRole('table', { name: /Videos/ });
    expect(table.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
      screen.getByText('Upload a file. It plays on your site once it is stored on Sia.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quickstart' })).toHaveAttribute(
      'href',
      '/studio/developers',
    );
    const uploads = screen.getAllByRole('link', { name: 'Upload video' });
    // only the empty state's; the sidebar holds the page's primary upload action
    expect(uploads).toHaveLength(1);
    await userEvent.click(uploads[0]);
    expect(await screen.findByText('upload page')).toBeInTheDocument();
    unmount();
    library();
    renderLibrary('/studio/videos?q=zzz');
    expect(await emptyTitle('No matching videos')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('Big Buck Bunny')).toBeInTheDocument();
  });

  it('takes files dropped anywhere on the page to the upload page', async () => {
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
    expect(await screen.findByText('upload page')).toBeInTheDocument();
    expect(screen.queryByText('Drop to upload')).not.toBeInTheDocument();
    const { takePendingFiles } = await import('@/lib/upload-page');
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
    expect(within(screen.getByRole('toolbar')).getByText('1 selected')).toBeInTheDocument();
  });

  it('does not mention Sia when none of the selected videos got their file', async () => {
    library([asset('w1', 'Waiting one', 'created'), asset('w2', 'Waiting two', 'created')]);
    renderLibrary();
    await screen.findByText('Waiting one');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Waiting one' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Waiting two' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('They are removed from your library. This cannot be undone.'),
    ).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
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
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
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
        perVideo(
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
    expect(within(screen.getByRole('toolbar')).getByText('6 selected')).toBeInTheDocument();
  });

  it('announces the selection in an always-mounted region and Clear returns focus to select all', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    const region = status();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    expect(region).toHaveTextContent('1 selected');
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(region).toHaveTextContent('Selection cleared');
    // which copy is the visible one is a container query; jsdom sees both
    expect(document.activeElement).toHaveAccessibleName('Select all on this page');
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected videos' })).not.toBeInTheDocument(),
    );
  });

  it('keeps focus on the page when Escape lets go of a selection from inside the bar', async () => {
    library();
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sintel' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    within(bar)
      .getByRole('button', { name: /Make private/ })
      .focus();
    await userEvent.keyboard('{Escape}');
    expect(status()).toHaveTextContent('Selection cleared');
    expect(document.activeElement).toHaveAccessibleName('Select all on this page');
  });

  it('copies the embed code of every selected ready video from the bar', async () => {
    library([bunny, sintel, failedOne]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Big Buck Bunny' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Broken upload' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    // both are public, so there is nothing to make public
    expect(within(bar).queryByRole('button', { name: 'Make public' })).toBeNull();
    await userEvent.click(within(bar).getByRole('button', { name: 'Copy embed code' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.lastCall![0]).toContain("'a1'");
    expect(writeText.mock.lastCall![0]).not.toContain("'f1'");
    expect(await screen.findByText('Embed code copied')).toBeInTheDocument();
  });

  it('asks before changing one video from its row menu', async () => {
    const server = library([bunny]);
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Big Buck Bunny' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make private' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Make this video private?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make private' }));
    expect(await screen.findByText('1 video is now private')).toBeInTheDocument();
    expect(server.calls.filter((c) => c.method === 'PATCH').map((c) => c.path)).toEqual([
      '/api/v1/assets/a1',
    ]);
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
      'Copy embed code',
      'Open video',
      'Preview',
      'Copy stream URL',
      'Make private',
      'Copy video ID',
      'Delete…',
    ]);
    expect(await names('Sintel')).toEqual([
      'Copy embed code',
      'Open video',
      'Preview',
      'Make public',
      'Copy video ID',
      'Delete…',
    ]);
    expect(await names('Broken upload')).toEqual([
      'Open video',
      'Make private',
      'Copy video ID',
      'Delete…',
    ]);
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
    expect(await within(sheet).findByTestId('player')).toHaveAttribute('data-asset', 'a1');
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
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open video' }));
    expect(await screen.findByText('video page')).toBeInTheDocument();
  });
});

describe('AssetsPage: versioned edits', () => {
  it('says a video changed elsewhere was left alone and the next try uses the latest version', async () => {
    const server = library([bunny, sintel]);
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'PATCH' && String(input).endsWith('/bad')) {
        server.calls.push({
          method: 'PATCH',
          path: '/api/v1/assets/bad',
          query: new URLSearchParams(),
          body: undefined,
        });
        return new Response(
          JSON.stringify({ error: 'This video was changed somewhere else.', current: sintel }),
          {
            status: 412,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return base(input, init);
    });
    renderLibrary();
    await screen.findByText('Big Buck Bunny');
    await userEvent.click(selectAll());
    await userEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Make private' }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Make private' }),
    );
    expect(await screen.findByText('1 video is now private')).toBeInTheDocument();
    expect(
      screen.getByText('Could not change 1 video. It was changed somewhere else, so try again'),
    ).toBeInTheDocument();
    const headers = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => new Headers(init!.headers).get('If-Match'));
    expect(headers).toEqual([`"${Date.parse(OLD)}"`, `"${Date.parse(OLD)}"`]);
  });
});
