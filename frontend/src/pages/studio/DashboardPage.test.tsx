import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import { WithSession, testSession } from '@/test/session';
import DashboardPage from './DashboardPage';

const DISMISS_KEY = `sluby:get-started-dismissed:${testSession.id}`;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const emptyStats = {
  total: 0,
  by_status: { created: 0, uploading: 0, processing: 0, ready: 0, failed: 0 },
  stored_bytes: 0,
  ready_duration_ms: 0,
  object_count: 0,
};

const stats = {
  total: 7,
  by_status: { created: 2, uploading: 0, processing: 1, ready: 3, failed: 1 },
  stored_bytes: 545_000_000,
  ready_duration_ms: 29_000,
  object_count: 42,
};

// GET /system/status for an ordinary account: a health summary only
const accountStatus = {
  scope: 'account',
  status: 'ok',
  checked_at: '2026-10-02T00:00:00.000Z',
  version: '0.2.0',
  database: { ok: true, latency_ms: 3 },
  redis: { ok: true, latency_ms: 7 },
  indexer: {
    ok: true,
    latency_ms: 218,
    network: 'mainnet',
    hosts: { total: 213, good_for_upload: 203, countries: 45 },
  },
};

const deploymentStatus = {
  ...accountStatus,
  scope: 'deployment',
  uptime_seconds: 3600,
  indexer: {
    ...accountStatus.indexer,
    url: 'https://sia.storage',
    account: {
      account_key: 'ed25519:abc',
      ready: true,
      app_name: 'Sluby',
      pinned_data: 1_000_000_000,
      pinned_size: 3_000_000_000,
      max_pinned_data: 50_000_000_000,
      remaining_storage: 49_000_000_000,
      last_used: '2026-10-01T00:00:00.000Z',
    },
  },
  reconciliation: null,
  cache: {
    hits: 3,
    misses: 1,
    object_bytes: 0,
    object_max_bytes: 1024,
    object_items: 0,
    manifest_items: 2,
  },
};

const accountRun = (missing = 0) => ({
  scope: 'account',
  id: 'r1',
  started_at: minutesAgo(3),
  finished_at: minutesAgo(3),
  created_at: minutesAgo(3),
  status: missing ? 'drift' : 'ok',
  missing_count: missing,
  missing_ids: [],
  missing_objects: [],
});

let seq = 0;
function video(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `v${seq}`,
    title: `Video ${seq}`,
    description: '',
    manifest_object_id: 'm',
    thumbnail_object_ids: [],
    duration_ms: 10_000,
    resolution: '1280x720',
    status: 'ready',
    access_tier: 'public',
    creator_address: 'user:1',
    segment_count: 1,
    total_storage_bytes: 1_000_000,
    created_at: minutesAgo(1),
    updated_at: minutesAgo(1),
    ...over,
  };
}

const page = (data: unknown[], total = data.length) => ({
  data,
  total,
  page: 1,
  limit: 20,
  next_cursor: null,
});

const usage = (total: number) => ({
  days: Array.from({ length: 90 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 6, 12) + i * 86_400_000).toISOString().slice(0, 10),
    plays: i === 89 ? total : 0,
  })),
  total,
});

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  status: 'processing',
  stage: 'upload',
  progress_percent: 65,
  created_at: minutesAgo(2),
  logs: [],
  ...over,
});

/** assets list routes split by the status filter, the way the server answers */
function assetsRoute(byStatus: Record<string, unknown[]>, all: unknown[]) {
  return (call: RecordedCall) => {
    const status = call.query.get('status');
    if (status) return page(byStatus[status] ?? []);
    return page(all);
  };
}

let routes: Record<string, unknown>;
let server: ReturnType<typeof jsonFetch>;

function setup(over: Record<string, unknown> = {}) {
  server = jsonFetch({ ...routes, ...over });
  vi.stubGlobal('fetch', vi.fn(server));
}

beforeEach(() => {
  localStorage.clear();
  routes = {
    '/api/v1/stats': stats,
    '/api/v1/stats/usage': usage(128),
    '/api/v1/system/status': accountStatus,
    '/api/v1/reconciliation': accountRun(),
    '/api/v1/keys': {
      data: [
        {
          id: 'k1',
          name: 'Server',
          scopes: ['read'],
          rate_limit: 100,
          is_active: true,
          created_at: minutesAgo(9),
          expires_at: null,
        },
      ],
      limits: { max_keys: 20, max_rate_limit: 10_000 },
    },
    '/api/v1/webhooks': { data: [] },
    '/api/v1/assets': assetsRoute({}, [video({ title: 'Big Buck Bunny' })]),
  };
});
afterEach(() => vi.unstubAllGlobals());

// a counting number is drawn twice, once aria-hidden for the eye and once
// for assistive tech; queries read the second
const readable = { ignore: '[aria-hidden="true"], script, style' };

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function render(operator = false) {
  return renderPage(
    <WithSession operator={operator}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <DashboardPage />
              <Where />
            </>
          }
        />
      </Routes>
    </WithSession>,
    { route: '/studio' },
  );
}

const card = (title: string) =>
  screen
    .getByRole('heading', { level: 2, name: title })
    .closest('[data-slot="card"]') as HTMLElement;

const steps = () =>
  within(screen.getByRole('list', { name: 'Steps' }))
    .getAllByRole('listitem')
    .map((li) => li as HTMLElement);

describe('Overview page', () => {
  it('is titled Overview, leaves the upload action to the sidebar, and shows no operator cards', async () => {
    setup({ '/api/v1/system/status': deploymentStatus });
    render(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Your videos and where they are stored')).toBeInTheDocument();
    await screen.findByRole('heading', { level: 2, name: 'Recent videos' });
    for (const title of [
      'Sia account',
      'Stream cache',
      'Storage check',
      'Storage usage',
      'Cache statistics',
      'Reconciliation',
    ]) {
      expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
    }
    // the sidebar's Upload video is the primary one; the header has none
    expect(document.querySelector('[data-slot="page-actions"]')).toBeNull();
  });

  describe('stat cards', () => {
    it('shows videos with a breakdown that adds up, storage, playable time and plays', async () => {
      setup();
      render();
      expect(await screen.findByText('7', readable)).toBeInTheDocument();
      expect(
        screen.getByText('3 ready, 1 failed, 1 processing, 2 waiting for file'),
      ).toBeInTheDocument();
      expect(screen.getByText('545 MB', readable)).toBeInTheDocument();
      expect(screen.getByText("Your files' size, before Sia adds redundancy")).toBeInTheDocument();
      expect(screen.getByText('Playable time')).toBeInTheDocument();
      expect(screen.getByText('0:29', readable)).toBeInTheDocument();
      expect(screen.getByText('Plays, last 30 days')).toBeInTheDocument();
      expect(screen.getByText('128', readable)).toBeInTheDocument();
      // the sparkline is decoration; the figure carries the number
      expect(document.querySelector('[data-slot="plays-sparkline"]')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      expect(screen.queryByText('Files on Sia')).not.toBeInTheDocument();
    });

    it('lets the totals be retried after they fail, in a sentence', async () => {
      setup({ '/api/v1/stats': reply(500, { error: 'Internal Server Error' }) });
      render();
      expect(await screen.findByText('Could not load your totals')).toBeInTheDocument();
      expect(screen.getByText(/The server ran into a problem \(error 500\)/)).toBeInTheDocument();
      server = jsonFetch({ ...routes });
      vi.stubGlobal('fetch', vi.fn(server));
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('7', readable)).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText('Could not load your totals')).not.toBeInTheDocument(),
      );
    });

    it('says when the totals last updated', async () => {
      setup();
      render();
      await screen.findByText('7', readable);
      expect(screen.getByText(/Totals updated just now/)).toBeInTheDocument();
    });

    it('polls the totals faster while uploads are still moving', async () => {
      setup();
      const { client } = render();
      await screen.findByText('7', readable);
      const query = client.getQueryCache().find({ queryKey: ['stats'] })!;
      const interval = query.observers[0].options.refetchInterval as (q: typeof query) => number;
      expect(interval(query)).toBe(5_000);
      query.setData({ ...stats, by_status: { ...stats.by_status, processing: 0 } });
      expect(interval(query)).toBe(15_000);
    });
  });

  describe('get started', () => {
    beforeEach(() => {
      routes['/api/v1/stats'] = emptyStats;
      routes['/api/v1/stats/usage'] = usage(0);
      routes['/api/v1/keys'] = { data: [], limits: { max_keys: 20, max_rate_limit: 10_000 } };
      routes['/api/v1/assets'] = assetsRoute({}, []);
    });

    it('does not tick the upload step for videos whose file never came', async () => {
      routes['/api/v1/stats'] = {
        ...emptyStats,
        total: 2,
        by_status: { ...emptyStats.by_status, created: 2 },
      };
      setup();
      render();
      await screen.findByRole('list', { name: 'Steps' });
      expect(within(steps()[1]).getByText(', Not done')).toBeInTheDocument();
      expect(within(steps()[1]).getByRole('button', { name: 'Upload video' })).toBeInTheDocument();
    });

    it('leads an empty account with the checklist, step 1 read from the real probe', async () => {
      setup();
      render();
      const list = await screen.findByRole('list', { name: 'Steps' });
      expect(card('Get started')).toHaveTextContent('1 of 4 done');
      const [sia, upload, play, key, hook] = steps();
      expect(within(sia).getByText('Connected to Sia mainnet')).toBeInTheDocument();
      expect(within(sia).getByText(', Done')).toBeInTheDocument();
      expect(within(upload).getByText(', Not done')).toBeInTheDocument();
      // the bar says the same as the count, and the next step gets the petrol edge
      expect(
        within(card('Get started')).getByRole('progressbar', { name: 'Get started progress' }),
      ).toHaveAttribute('aria-valuenow', '25');
      expect(upload).toHaveAttribute('data-current', 'true');
      expect(upload).toHaveClass('border-2', 'border-primary');
      for (const other of [sia, play, key, hook]) expect(other).not.toHaveAttribute('data-current');
      expect(within(play).getByRole('button', { name: 'Get embed code' })).toBeDisabled();
      expect(within(play).getByText('Available once a video is ready.')).toBeInTheDocument();
      expect(within(key).getByRole('link', { name: 'Create key' })).toHaveAttribute(
        'href',
        '/studio/developers/keys?create=key',
      );
      expect(within(hook).getByText('Optional')).toBeInTheDocument();
      expect(within(hook).getByRole('link', { name: 'Add webhook' })).toHaveAttribute(
        'href',
        '/studio/developers/webhooks?create=webhook',
      );
      expect(list.tagName).toBe('OL');
      // the empty library says what to do
      expect(within(card('Recent videos')).getByText('No videos yet')).toBeInTheDocument();
    });

    it('opens the upload sheet in place from step 2', async () => {
      setup();
      render();
      await screen.findByRole('list', { name: 'Steps' });
      await userEvent.click(within(steps()[1]).getByRole('button', { name: 'Upload video' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/studio?upload=1');
    });

    it('tells a member whose server cannot reach Sia to ask the operator', async () => {
      setup({
        '/api/v1/system/status': {
          ...accountStatus,
          status: 'degraded',
          indexer: { ...accountStatus.indexer, ok: false },
        },
      });
      render();
      await screen.findByRole('list', { name: 'Steps' });
      const sia = steps()[0];
      expect(
        within(sia).getByText('This server cannot reach the Sia indexer.'),
      ).toBeInTheDocument();
      expect(within(sia).getByText('Ask the operator of this server.')).toBeInTheDocument();
      expect(card('Get started')).toHaveTextContent('0 of 4 done');
    });

    it('gives an operator the probe error under Details and a way to Health', async () => {
      setup({
        '/api/v1/system/status': {
          ...deploymentStatus,
          status: 'degraded',
          indexer: {
            ...deploymentStatus.indexer,
            ok: false,
            error: 'connect ECONNREFUSED 10.0.0.4:9980',
          },
        },
      });
      render(true);
      await screen.findByRole('list', { name: 'Steps' });
      const sia = steps()[0];
      expect(within(sia).getByRole('link', { name: 'Open health' })).toHaveAttribute(
        'href',
        '/studio/deployment',
      );
      expect(
        within(sia).getByText('connect ECONNREFUSED 10.0.0.4:9980').closest('details'),
      ).not.toHaveAttribute('open');
    });

    it('counts an operator whose Sia account is not ready as not connected', async () => {
      setup({
        '/api/v1/system/status': {
          ...deploymentStatus,
          indexer: {
            ...deploymentStatus.indexer,
            account: { ...deploymentStatus.indexer.account, ready: false },
          },
        },
      });
      render(true);
      await screen.findByRole('list', { name: 'Steps' });
      expect(within(steps()[0]).getByText('The Sia account is not ready yet.')).toBeInTheDocument();
    });

    it('shows what step 2 is doing while the first video processes', async () => {
      const busy = video({ id: 'p1', title: 'Product walkthrough', status: 'processing' });
      setup({
        '/api/v1/stats': {
          ...emptyStats,
          total: 1,
          by_status: { ...emptyStats.by_status, processing: 1 },
        },
        '/api/v1/assets': assetsRoute({}, [busy]),
        '/api/v1/assets/p1/processing': job(),
      });
      render();
      await screen.findByRole('list', { name: 'Steps' });
      await waitFor(() =>
        expect(steps()[1]).toHaveTextContent('Processing “Product walkthrough”, 65%'),
      );
      expect(within(steps()[1]).getByText(', Done')).toBeInTheDocument();
    });

    it('points step 3 at a ready video and ticks it on a real play', async () => {
      const ready = video({ id: 'r1', title: 'Teaser' });
      setup({
        '/api/v1/stats': {
          ...emptyStats,
          total: 1,
          by_status: { ...emptyStats.by_status, ready: 1 },
        },
        '/api/v1/assets': assetsRoute({ ready: [ready] }, [ready]),
      });
      const { client } = render();
      await screen.findByRole('list', { name: 'Steps' });
      expect(
        await within(steps()[2]).findByRole('link', { name: 'Get embed code' }),
      ).toHaveAttribute('href', '/studio/videos/r1?panel=share');

      server = jsonFetch({
        ...routes,
        '/api/v1/stats/usage': usage(1),
        '/api/v1/stats': {
          ...emptyStats,
          total: 1,
          by_status: { ...emptyStats.by_status, ready: 1 },
        },
        '/api/v1/assets': assetsRoute({ ready: [ready] }, [ready]),
      });
      vi.stubGlobal('fetch', vi.fn(server));
      await act(() => client.refetchQueries({ queryKey: ['stats', 'usage'] }));
      expect(await within(steps()[2]).findByText(', Done')).toBeInTheDocument();
      expect(card('Get started')).toHaveTextContent('3 of 4 done');
    });

    it('explains that only a play on your site ticks step 3', async () => {
      const ready = video({ id: 'r1', title: 'Teaser' });
      setup({
        '/api/v1/stats': {
          ...emptyStats,
          total: 1,
          by_status: { ...emptyStats.by_status, ready: 1 },
        },
        '/api/v1/assets': assetsRoute({ ready: [ready] }, [ready]),
      });
      render();
      await screen.findByRole('list', { name: 'Steps' });
      expect(
        await within(steps()[2]).findByText(/previews in the Studio do not count/),
      ).toBeInTheDocument();
    });

    it('ticks step 3 from a video that has been played, even outside the 90 days of usage', async () => {
      const played = video({ id: 'r1', title: 'Teaser', play_count: 4 });
      setup({
        '/api/v1/stats': {
          ...emptyStats,
          total: 1,
          by_status: { ...emptyStats.by_status, ready: 1 },
        },
        '/api/v1/assets': assetsRoute({ ready: [played] }, [played]),
      });
      render();
      await screen.findByRole('list', { name: 'Steps' });
      expect(within(steps()[2]).getByText(', Done')).toBeInTheDocument();
    });

    it('stays hidden after it is dismissed, also after a reload', async () => {
      setup();
      const first = render();
      await screen.findByRole('list', { name: 'Steps' });
      await userEvent.click(screen.getByRole('button', { name: 'Hide get started' }));
      await waitFor(() =>
        expect(screen.queryByRole('list', { name: 'Steps' })).not.toBeInTheDocument(),
      );
      expect(localStorage.getItem(DISMISS_KEY)).toBe('dismissed');
      first.unmount();
      render();
      await screen.findByRole('heading', { level: 2, name: 'Recent videos' });
      expect(screen.queryByRole('heading', { name: 'Get started' })).not.toBeInTheDocument();
    });

    it('is not drawn when the data it needs could not load', async () => {
      setup({ '/api/v1/keys': reply(500, { error: 'boom' }) });
      render();
      await screen.findByRole('heading', { level: 2, name: 'Recent videos' });
      await waitFor(() => expect(server.calls.some((c) => c.path === '/api/v1/keys')).toBe(true));
      expect(screen.queryByRole('heading', { name: 'Get started' })).not.toBeInTheDocument();
    });

    it('still shows when the browser blocks storage', async () => {
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      setup();
      render();
      expect(await screen.findByRole('list', { name: 'Steps' })).toBeInTheDocument();
      get.mockRestore();
    });

    it('never draws for an account that finished it, and remembers that', async () => {
      setup({
        '/api/v1/stats': stats,
        '/api/v1/stats/usage': usage(5),
        '/api/v1/keys': routes['/api/v1/keys'] ?? {
          data: [],
          limits: { max_keys: 20, max_rate_limit: 10_000 },
        },
      });
      server = jsonFetch({
        ...routes,
        '/api/v1/stats': stats,
        '/api/v1/stats/usage': usage(5),
        '/api/v1/keys': {
          data: [
            {
              id: 'k1',
              name: 'Server',
              scopes: ['read'],
              rate_limit: 100,
              is_active: true,
              created_at: minutesAgo(9),
              expires_at: null,
            },
          ],
          limits: { max_keys: 20, max_rate_limit: 10_000 },
        },
        '/api/v1/assets': assetsRoute({}, [video()]),
      });
      vi.stubGlobal('fetch', vi.fn(server));
      render();
      await screen.findByRole('heading', { level: 2, name: 'Recent videos' });
      expect(screen.queryByRole('heading', { name: 'Get started' })).not.toBeInTheDocument();
      await waitFor(() => expect(localStorage.getItem(DISMISS_KEY)).toBe('done'));
    });
  });

  describe('needs attention', () => {
    it('does not call the library empty when its only video is a stalled upload', async () => {
      const stalled = video({
        id: 's1',
        title: 'Lost upload',
        status: 'created',
        created_at: minutesAgo(25),
        updated_at: minutesAgo(25),
      });
      setup({ '/api/v1/assets': assetsRoute({ created: [stalled] }, [stalled]) });
      render();
      await screen.findByRole('list', { name: 'Needs attention' });
      const recent = card('Recent videos');
      expect(within(recent).queryByText('No videos yet')).not.toBeInTheDocument();
      expect(within(recent).getByText('No finished videos yet')).toBeInTheDocument();
      expect(
        within(recent).getByText('Uploads that did not finish are listed under Needs attention.'),
      ).toBeInTheDocument();
    });

    it('counts every stalled upload, not only the five it lists', async () => {
      const waiting = Array.from({ length: 12 }, (_, i) =>
        video({
          id: `s${i}`,
          title: `Lost ${i}`,
          status: 'created',
          created_at: minutesAgo(60 + i),
          updated_at: minutesAgo(60 + i),
        }),
      );
      setup({
        '/api/v1/assets': (call: RecordedCall) => {
          const status = call.query.get('status');
          if (status !== 'created') return page([]);
          // the list it shows asks for five; the count walks every page
          const limit = Number(call.query.get('limit'));
          return page(waiting.slice(0, limit), waiting.length);
        },
      });
      render();
      const attention = await screen.findByRole('list', { name: 'Needs attention' });
      await waitFor(() => expect(within(attention).getAllByRole('listitem')).toHaveLength(5));
      await waitFor(() => expect(card('Needs attention')).toHaveTextContent('and 7 more'));
      expect(card('Needs attention')).toHaveTextContent('12');
    });

    it('is not drawn when nothing needs attention', async () => {
      setup();
      render();
      await screen.findByRole('heading', { level: 2, name: 'Recent videos' });
      expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
    });

    it('lists a failed video with its reason, missing files, a failing webhook and a stalled upload', async () => {
      const broken = video({ id: 'f1', title: 'Broken upload', status: 'failed' });
      const stalled = video({
        id: 's1',
        title: 'Lost upload',
        status: 'created',
        created_at: minutesAgo(25),
        updated_at: minutesAgo(25),
      });
      const fresh = video({
        id: 's2',
        title: 'Just started',
        status: 'created',
        created_at: minutesAgo(2),
        updated_at: minutesAgo(2),
      });
      setup({
        '/api/v1/reconciliation': accountRun(2),
        '/api/v1/webhooks': {
          data: [
            {
              id: 'w1',
              url: 'https://example.com/hooks/sluby',
              events: ['video.ready'],
              is_active: true,
              created_at: minutesAgo(60),
              last_delivery_at: minutesAgo(5),
              last_delivery_ok: false,
            },
          ],
        },
        '/api/v1/assets': assetsRoute({ failed: [broken], created: [stalled, fresh] }, [
          fresh,
          broken,
          stalled,
        ]),
        '/api/v1/assets/f1/processing': job({
          status: 'failed',
          stage: 'failed',
          error_message: 'ffprobe: Invalid data found when processing input',
          retryable: false,
        }),
      });
      render();
      const attention = await screen.findByRole('list', { name: 'Needs attention' });
      const rows = () => within(attention).getAllByRole('listitem');
      await waitFor(() => expect(rows()).toHaveLength(4));
      const text = rows().map((r) => r.textContent);
      expect(text[0]).toContain('2 files are missing from Sia');
      expect(text[1]).toContain('“Broken upload” failed');
      expect(
        await within(rows()[1]).findByText('The file is not a readable video.'),
      ).toBeInTheDocument();
      expect(
        within(rows()[1]).getByRole('link', { name: 'Open video Broken upload' }),
      ).toHaveAttribute('href', '/studio/videos/f1');
      expect(text[2]).toContain('Deliveries to example.com/hooks/sluby are failing');
      expect(text[2]).toContain('Last attempt 5 minutes ago');
      // named after its endpoint, like the video rows, so several read apart
      expect(
        within(rows()[2]).getByRole('link', { name: 'Open webhook example.com/hooks/sluby' }),
      ).toHaveAttribute('href', '/studio/developers/webhooks/w1');
      // wraps at a large text size instead of running out of the card (1.4.4)
      expect(
        within(rows()[2]).getByRole('link', { name: 'Open webhook example.com/hooks/sluby' }),
      ).toHaveClass('whitespace-normal', 'shrink', 'pointer-coarse:h-auto');
      expect(text[3]).toContain('“Lost upload” did not finish uploading');
      expect(attention.textContent).not.toContain('Just started');
      // a member cannot open health
      expect(
        within(attention).queryByRole('link', { name: 'Open health' }),
      ).not.toBeInTheDocument();
    });

    it('puts a service that is down first, with Health for operators', async () => {
      setup({
        '/api/v1/system/status': {
          ...deploymentStatus,
          status: 'down',
          redis: { ok: false, latency_ms: 0 },
        },
        '/api/v1/reconciliation': reply(404, { error: 'none' }),
      });
      render(true);
      const attention = await screen.findByRole('list', { name: 'Needs attention' });
      const row = within(attention).getAllByRole('listitem')[0];
      expect(row).toHaveTextContent('The job queue is not responding');
      expect(within(row).getByRole('link', { name: 'Open health' })).toHaveAttribute(
        'href',
        '/studio/deployment',
      );
    });

    it('draws a failed video in recent videos with the same failed thumbnail as the library', async () => {
      const failed = video({ id: 'f1', title: 'Teaser', status: 'failed' });
      setup({
        '/api/v1/assets': assetsRoute({ failed: [failed] }, [failed]),
        '/api/v1/assets/f1/processing': job({
          status: 'failed',
          stage: 'failed',
          retryable: false,
        }),
      });
      render();
      const recent = await screen.findByRole('list', { name: 'Recent videos' });
      const link = await within(recent).findByRole('link', { name: /Teaser/ });
      expect(link.querySelector('[data-state="failed"]')).not.toBeNull();
    });

    it('offers Retry processing on a failed video that retrying can fix', async () => {
      const failed = video({ id: 'f1', title: 'Teaser', status: 'failed' });
      setup({
        '/api/v1/assets': assetsRoute({ failed: [failed] }, []),
        '/api/v1/assets/f1/processing': job({
          status: 'failed',
          stage: 'failed',
          error_message: 'sia upload timed out',
          retryable: true,
          logs: [{ stage: 'upload', message: 'x', at: minutesAgo(1) }],
        }),
        'POST /api/v1/assets/f1/retry': reply(202, { stage: 'upload-segments' }),
      });
      render();
      const attention = await screen.findByRole('list', { name: 'Needs attention' });
      await userEvent.click(
        await within(attention).findByRole('button', { name: 'Retry processing' }),
      );
      expect(await screen.findByText(/^“Teaser”: processing restarted from/)).toBeInTheDocument();
    });

    it('shows five rows at most and counts the rest, linking to the failed videos', async () => {
      const failed = Array.from({ length: 5 }, (_, i) =>
        video({ id: `f${i}`, title: `Failed ${i}`, status: 'failed' }),
      );
      const routesFor: Record<string, unknown> = {
        '/api/v1/system/status': {
          ...accountStatus,
          status: 'down',
          database: { ok: false, latency_ms: 0 },
        },
        '/api/v1/assets': (call: RecordedCall) =>
          call.query.get('status') === 'failed' ? page(failed, 9) : page([]),
      };
      for (let i = 0; i < 5; i++)
        routesFor[`/api/v1/assets/f${i}/processing`] = job({
          status: 'failed',
          stage: 'failed',
          error_message: 'boom',
        });
      setup(routesFor);
      render();
      const attention = await screen.findByRole('list', { name: 'Needs attention' });
      expect(within(attention).getAllByRole('listitem')).toHaveLength(5);
      // 1 service + 9 failed = 10, five shown
      expect(card('Needs attention')).toHaveTextContent('10');
      expect(screen.getByRole('link', { name: 'and 5 more' })).toHaveAttribute(
        'href',
        '/studio/videos?status=failed',
      );
    });
  });

  describe('recent videos', () => {
    it('leaves out uploads whose file never came, and shows six rows at most', async () => {
      const rows = Array.from({ length: 8 }, (_, i) => video({ title: `Clip ${i}` }));
      const stale = video({ title: 'Abandoned', status: 'created', created_at: minutesAgo(30) });
      setup({ '/api/v1/assets': assetsRoute({}, [stale, ...rows]) });
      render();
      const list = await screen.findByRole('list', { name: 'Recent videos' });
      expect(within(list).getAllByRole('listitem')).toHaveLength(6);
      expect(list).not.toHaveTextContent('Abandoned');
      expect(within(list).getByRole('link', { name: /Clip 0/ })).toHaveAttribute(
        'href',
        `/studio/videos/${rows[0].id}`,
      );
    });

    it('shows where a processing video is, with a calm dot instead of a spinner', async () => {
      const busy = video({ id: 'p1', title: 'Big Buck Bunny', status: 'processing' });
      setup({ '/api/v1/assets': assetsRoute({}, [busy]), '/api/v1/assets/p1/processing': job() });
      render();
      expect(await screen.findByText(/Storing on Sia, 65%/)).toBeInTheDocument();
      expect(
        screen.getByRole('progressbar', { name: 'Big Buck Bunny, processing progress' }),
      ).toHaveAttribute('aria-valuenow', '65');
      const row = screen.getByRole('link', { name: /Big Buck Bunny/ });
      expect(row.querySelector('[data-slot="status-dot"]')).not.toBeNull();
      expect(row.querySelector('[data-slot="spinner"], .animate-spin')).toBeNull();
    });

    it('lets a title wrap to two lines and set its own direction', async () => {
      setup({ '/api/v1/assets': assetsRoute({}, [video({ title: 'عنوان طويل جدا' })]) });
      render();
      const title = await screen.findByText('عنوان طويل جدا');
      expect(title).toHaveAttribute('dir', 'auto');
      expect(title).toHaveClass('line-clamp-2', 'wrap-anywhere');
    });

    it('retries a failed video that retrying can fix, with the toast in plain words', async () => {
      const failed = video({ id: 'f1', title: 'Big Buck Bunny', status: 'failed' });
      setup({
        '/api/v1/assets': assetsRoute({ failed: [failed] }, [failed]),
        '/api/v1/assets/f1/processing': job({
          status: 'failed',
          stage: 'failed',
          error_message: 'sia upload timed out',
          retryable: true,
          logs: [{ stage: 'upload', message: 'x', at: minutesAgo(1) }],
        }),
        'POST /api/v1/assets/f1/retry': reply(202, { stage: 'upload-segments' }),
      });
      render();
      await userEvent.click(
        await screen.findByRole('button', { name: 'Retry processing Big Buck Bunny' }),
      );
      expect(
        await screen.findByText('“Big Buck Bunny”: processing restarted from Storing on Sia'),
      ).toBeInTheDocument();
    });

    it('offers no retry for a file that is not a video', async () => {
      const failed = video({ id: 'f1', title: 'Broken', status: 'failed' });
      setup({
        '/api/v1/assets': assetsRoute({ failed: [failed] }, [failed]),
        '/api/v1/assets/f1/processing': job({
          status: 'failed',
          stage: 'failed',
          error_message: 'Invalid data found when processing input',
          retryable: false,
        }),
      });
      render();
      await screen.findByRole('link', { name: /^Broken/ });
      await waitFor(() =>
        expect(server.calls.some((c) => c.path === '/api/v1/assets/f1/processing')).toBe(true),
      );
      expect(screen.queryByRole('button', { name: /Retry processing/ })).not.toBeInTheDocument();
    });

    it('never asks the gateway for a private thumbnail', async () => {
      const priv = video({ title: 'Secret', access_tier: 'private', thumbnail_object_ids: ['t1'] });
      const pub = video({ title: 'Open clip', thumbnail_object_ids: ['t2'] });
      setup({ '/api/v1/assets': assetsRoute({}, [priv, pub]) });
      const { container } = render();
      const row = await screen.findByRole('link', { name: /Secret/ });
      expect(
        within(row).getByRole('img', { name: 'Private video, no preview' }),
      ).toBeInTheDocument();
      const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
      expect(srcs.some((src) => src?.includes('t2'))).toBe(true);
      expect(srcs.some((src) => src?.includes('t1'))).toBe(false);
    });

    it('says when the list cannot load, with Try again', async () => {
      setup({ '/api/v1/assets': reply(502, { error: 'Bad Gateway' }) });
      render();
      expect(await screen.findByText('Could not load your videos')).toBeInTheDocument();
    });
  });

  describe('status', () => {
    it('folds the database and job queue into one row for a member, and says the files are on Sia', async () => {
      setup();
      render();
      await screen.findByText('218 ms');
      const c = card('Status');
      expect(within(c).getByText('Operational')).toBeInTheDocument();
      expect(within(c).getByText('Sia storage')).toBeInTheDocument();
      expect(within(c).getByText('218 ms')).toBeInTheDocument();
      expect(within(c).getByText('This server')).toBeInTheDocument();
      expect(within(c).getByText('7 ms')).toBeInTheDocument();
      expect(within(c).getByText('Your files on Sia')).toBeInTheDocument();
      expect(within(c).getByText('All on Sia (checked 3 minutes ago)')).toBeInTheDocument();
      expect(within(c).queryByText(/Redis|Job queue|Database/)).not.toBeInTheDocument();
      expect(within(c).queryByRole('link', { name: 'Open health' })).not.toBeInTheDocument();
    });

    it('gives an operator a way to Health', async () => {
      setup({ '/api/v1/system/status': deploymentStatus });
      render(true);
      await screen.findByText('218 ms');
      const c = card('Status');
      expect(within(c).getByRole('link', { name: 'Open health' })).toHaveAttribute(
        'href',
        '/studio/deployment',
      );
    });

    it('shows the error in the card with Try again instead of a skeleton forever', async () => {
      setup({ '/api/v1/system/status': reply(500, { error: 'Internal Server Error' }) });
      render();
      expect(await screen.findByText('Could not load the status')).toBeInTheDocument();
    });

    it('says the storage check could not load instead of claiming it never ran', async () => {
      setup({ '/api/v1/reconciliation': reply(500, { error: 'boom' }) });
      render();
      expect(await screen.findByText('Could not load the storage check')).toBeInTheDocument();
      expect(screen.queryByText('Not checked yet')).not.toBeInTheDocument();
    });

    it('says a check has not run yet', async () => {
      setup({ '/api/v1/reconciliation': reply(404, { error: 'none' }) });
      render();
      expect(await screen.findByText('Not checked yet')).toBeInTheDocument();
    });
  });

  it('holds its first draw until the answers that decide the layout are in', async () => {
    let answer: (r: Response) => void = () => {};
    setup({
      '/api/v1/webhooks': () =>
        new Promise<Response>((r) => {
          answer = r;
        }),
    });
    render();
    // stats are in, but whether Needs attention shows is not known yet
    await waitFor(() => expect(server.calls.some((c) => c.path === '/api/v1/stats')).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('7', readable)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Recent videos' })).toBeInTheDocument();
    await act(async () =>
      answer(new Response('{"data":[]}', { headers: { 'content-type': 'application/json' } })),
    );
    expect(await screen.findByText('7', readable)).toBeInTheDocument();
  });

  describe('with an answer that decides the layout coming slowly', () => {
    const failingHook = {
      data: [
        {
          id: 'w1',
          url: 'https://example.com/hooks/sluby',
          events: ['video.ready'],
          is_active: true,
          created_at: minutesAgo(60),
          last_delivery_at: minutesAgo(5),
          last_delivery_ok: false,
        },
      ],
    };
    let answer: (r: Response) => void;
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      setup({
        '/api/v1/webhooks': () =>
          new Promise<Response>((r) => {
            answer = r;
          }),
      });
    });
    afterEach(() => vi.useRealTimers());
    const hooks = () =>
      act(async () =>
        answer(
          new Response(JSON.stringify(failingHook), {
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );

    it('keeps its first draw for it, so Needs attention is there from the start instead of pushing the totals down', async () => {
      render();
      await waitFor(() => expect(server.calls.some((c) => c.path === '/api/v1/stats')).toBe(true));
      // 8 s: a slow server, well past the old 1.5 s wait
      await act(async () => vi.advanceTimersByTime(8_000));
      expect(screen.queryByText('7', readable)).not.toBeInTheDocument();
      await hooks();
      expect(await screen.findByText('7', readable)).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Needs attention' })).toBeInTheDocument();
    });

    it('draws what it has once the wait is over, rather than holding the page for good', async () => {
      render();
      await waitFor(() => expect(server.calls.some((c) => c.path === '/api/v1/stats')).toBe(true));
      await act(async () => vi.advanceTimersByTime(10_000));
      expect(await screen.findByText('7', readable)).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Needs attention' })).not.toBeInTheDocument();
    });
  });
});
