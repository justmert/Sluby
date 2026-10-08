import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import DashboardPage from './DashboardPage';

const stats = {
  total: 9,
  by_status: { created: 2, uploading: 1, processing: 1, ready: 4, failed: 1 },
  stored_bytes: 5_000_000,
  ready_duration_ms: 125_000,
  object_count: 42,
};

// GET /system/status for an ordinary account: a health summary only
const accountStatus = {
  scope: 'account',
  status: 'degraded',
  checked_at: '2026-10-02T00:00:00.000Z',
  version: '0.1.0',
  database: { ok: true, latency_ms: 2 },
  redis: { ok: true, latency_ms: 1 },
  indexer: {
    ok: false,
    latency_ms: 30,
    network: 'mainnet',
    hosts: { total: 213, good_for_upload: 193, countries: 45 },
  },
};

// the same call for an operator: the whole deployment
const deploymentStatus = {
  ...accountStatus,
  scope: 'deployment',
  uptime_seconds: 3600,
  indexer: {
    ...accountStatus.indexer,
    error: 'indexer account is not ready yet',
    url: 'https://sia.storage',
    account: {
      account_key: 'ed25519:abc',
      ready: false,
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

const finished = new Date(Date.now() - 5 * 60_000).toISOString();
const accountRun = {
  scope: 'account',
  id: 'r1',
  started_at: finished,
  finished_at: finished,
  created_at: finished,
  status: 'drift',
  missing_count: 2,
  missing_ids: ['o1', 'o2'],
};
const deploymentRun = {
  scope: 'deployment',
  id: 'r1',
  started_at: finished,
  finished_at: finished,
  created_at: finished,
  status: 'drift',
  db_object_count: 120,
  indexer_object_count: 128,
  in_sync_count: 118,
  orphan_count: 9,
  missing_count: 2,
  error_message: null,
  missing_ids: ['o1', 'o2'],
  orphaned_ids: [],
};

const assets = {
  data: [
    {
      id: 'a1',
      title: 'Big Buck Bunny',
      description: '',
      manifest_object_id: 'm',
      thumbnail_object_ids: [],
      duration_ms: 60_000,
      resolution: '1280x720',
      status: 'ready',
      access_tier: 'public',
      creator_address: 'user:1',
      segment_count: 1,
      total_storage_bytes: 1024,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  total: 1,
  page: 1,
  limit: 6,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let routes: Record<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routes = {
    'GET /api/v1/stats': () => json(stats),
    'GET /api/v1/system/status': () => json(accountStatus),
    'GET /api/v1/reconciliation': () => json(accountRun),
    'GET /api/v1/assets': () => json(assets),
  };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
      .replace(/^https?:\/\/[^/]+/, '')
      .split('?')[0];
    const key = `${init?.method ?? 'GET'} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`unmocked ${key}`);
    return route();
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// a counting number is drawn twice, once aria-hidden for the eye and once
// for assistive tech; queries read the second
const readable = { ignore: '[aria-hidden="true"], script, style' };

function render(operator = false) {
  return renderPage(
    <WithSession operator={operator}>
      <DashboardPage />
    </WithSession>,
  );
}

describe('DashboardPage', () => {
  it('shows library totals whose parts add up, created uploads included', async () => {
    render();
    expect(await screen.findByText('9', readable)).toBeInTheDocument();
    expect(screen.getByText('4 ready, 4 in progress, 1 failed')).toBeInTheDocument();
    expect(screen.getByText('5 MB', readable)).toBeInTheDocument();
    expect(screen.getByText('42', readable)).toBeInTheDocument();
  });

  it('gives an account a health summary and the drift of its own objects only', async () => {
    render();
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('193 of 213 accept uploads, 45 countries')).toBeInTheDocument();
    expect(
      await screen.findByText('2 objects missing from Sia, checked 5 minutes ago'),
    ).toBeInTheDocument();
    expect(screen.getByText('v0.1.0')).toBeInTheDocument();

    // nothing the account cannot have, and nothing that never resolves
    expect(screen.queryByText('Storage usage')).not.toBeInTheDocument();
    expect(screen.queryByText('Cache statistics')).not.toBeInTheDocument();
    expect(screen.queryByText('Reconciliation')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|never run|Loading account usage/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([u]) => String(u))).not.toContain('/api/v1/metrics');
  });

  it('says when no reconciliation run has finished yet', async () => {
    routes['GET /api/v1/reconciliation'] = () =>
      json({ error: 'No reconciliation run has completed yet' }, 404);
    render();
    expect(await screen.findByText('not checked yet')).toBeInTheDocument();
  });

  it('shows the error inside the status card instead of a skeleton forever', async () => {
    routes['GET /api/v1/system/status'] = () => json({ error: 'Internal Server Error' }, 500);
    render(true);
    expect(
      await screen.findByText('Could not load the status: Internal Server Error'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Deployment, shown to operators')).not.toBeInTheDocument();
  });

  it('shows an operator the indexer account, the cache and the whole run', async () => {
    routes['GET /api/v1/system/status'] = () => json(deploymentStatus);
    routes['GET /api/v1/reconciliation'] = () => json(deploymentRun);
    render(true);

    expect(await screen.findByText('1 GB', readable)).toBeInTheDocument();
    expect(screen.getByText('of 50 GB')).toBeInTheDocument();
    expect(screen.getByText('75%', readable)).toBeInTheDocument();
    expect(screen.getByText('indexer account is not ready yet')).toBeInTheDocument();
    expect(screen.getByText('v0.1.0, up 1:00:00')).toBeInTheDocument();

    const run = screen.getByText('Reconciliation').closest('[data-slot="card"]') as HTMLElement;
    expect(await within(run).findByText('Drift')).toBeInTheDocument();
    expect(within(run).getByText('118')).toBeInTheDocument();
    expect(within(run).getByText('9')).toBeInTheDocument();
    // the account row would repeat the run's figures as if they were the operator's own
    expect(screen.queryByText('Your objects')).not.toBeInTheDocument();
  });

  it('lets an operator queue a reconciliation run', async () => {
    routes['GET /api/v1/system/status'] = () => json(deploymentStatus);
    routes['GET /api/v1/reconciliation'] = () => json(deploymentRun);
    routes['POST /api/v1/reconciliation/run'] = () =>
      json({ enqueued: true, already_pending: false }, 202);
    render(true);

    await userEvent.click(await screen.findByRole('button', { name: /run now/i }));
    expect(await screen.findByText('Reconciliation run queued')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([u, i]) => String(u) === '/api/v1/reconciliation/run' && i?.method === 'POST',
        ),
      ).toHaveLength(1),
    );
  });

  it('keeps an operator on the summary when the server only grants the account view', async () => {
    render(true);
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.queryByText('Deployment, shown to operators')).not.toBeInTheDocument();
  });

  it('lists the latest uploads from the sdk', async () => {
    render();
    const link = await screen.findByRole('link', { name: /Big Buck Bunny/ });
    expect(link).toHaveAttribute('href', '/studio/assets/a1');
  });

  it('draws stat values with StatValue: a 32px skeleton line that the number replaces', async () => {
    let answer: (r: Response) => void = () => {};
    routes['GET /api/v1/stats'] = () => new Promise<Response>((r) => (answer = r)) as never;
    render();
    const cards = () => [...document.querySelectorAll('[data-slot="card"][data-size="sm"]')];
    await waitFor(() => expect(cards()).toHaveLength(4));
    for (const card of cards()) {
      expect(card.querySelector('[data-slot="stat-value"]')).toHaveClass('h-8');
    }
    // a hint that waits on the totals keeps its line while loading
    const assetsCard = cards()[0] as HTMLElement;
    expect(
      assetsCard.querySelector('[data-slot="card-content"] [data-slot="skeleton"]'),
    ).not.toBeNull();

    await act(async () => answer(json(stats)));
    const value = await screen.findByText('9', readable);
    expect(value.parentElement).toHaveClass('text-2xl', 'leading-8', 'tabular-nums');
    expect(document.querySelector('[data-slot="stat-value"]')).toBeNull();
  });

  it('lays the operator cards out by the width of the content, not the viewport', async () => {
    routes['GET /api/v1/system/status'] = () => json(deploymentStatus);
    routes['GET /api/v1/reconciliation'] = () => json(deploymentRun);
    render(true);
    const section = await screen.findByRole('region', { name: 'Deployment' });
    expect(section.closest('.\\@container\\/dash')).not.toBeNull();
    const grid = section.querySelector('.grid') as HTMLElement;
    // one column until the container has room for two 336px cards
    expect(grid.className).toMatch(/@2xl\/dash:grid-cols-2/);
    expect(grid.className).not.toMatch(/(^|\s)(md|lg|xl):grid-cols/);
    // a long value moves under its label as a whole instead of wrapping per letter
    const label = await screen.findByText('Objects compared');
    expect(label.parentElement).toHaveClass('flex-wrap');
    expect(label).not.toHaveClass('shrink-0');
  });

  it('keeps the status card at its final size while the status loads', async () => {
    routes['GET /api/v1/system/status'] = () => new Promise<Response>(() => {}) as never;
    render();
    const card = (await screen.findByText('Service status')).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    // three probes, then network, hosts, your objects and backend: one placeholder per row
    expect(card.querySelectorAll('.h-5.justify-between')).toHaveLength(7);
    expect(card.querySelector('.h-40')).toBeNull();
  });

  it('asks for fresh totals as soon as a latest upload settles', async () => {
    const processing = { ...assets.data[0], status: 'processing', total_storage_bytes: 0 };
    routes['GET /api/v1/assets'] = () => json({ ...assets, data: [processing] });
    routes['GET /api/v1/assets/a1/processing'] = () =>
      json({
        id: 'j1',
        status: 'processing',
        stage: 'upload',
        progress_percent: 65,
        created_at: new Date().toISOString(),
      });
    const { client } = render();
    await screen.findByRole('link', { name: /Big Buck Bunny/ });
    const statsCalls = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/v1/stats')).length;
    await waitFor(() => expect(statsCalls()).toBe(1));

    routes['GET /api/v1/assets'] = () => json(assets);
    await act(() => client.refetchQueries({ queryKey: ['assets', 'latest'] }));
    await waitFor(() => expect(statsCalls()).toBe(2));
  });

  it('shows where a processing upload is and how far along', async () => {
    const processing = { ...assets.data[0], status: 'processing', total_storage_bytes: 0 };
    routes['GET /api/v1/assets'] = () => json({ ...assets, data: [processing] });
    routes['GET /api/v1/assets/a1/processing'] = () =>
      json({
        id: 'j1',
        status: 'processing',
        stage: 'upload',
        progress_percent: 65,
        created_at: new Date().toISOString(),
      });
    render();
    expect(await screen.findByText(/Storing on Sia, 65%/)).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Big Buck Bunny: processing progress' }),
    ).toHaveAttribute('aria-valuenow', '65');
  });

  it('polls the totals faster while uploads are still moving', async () => {
    const { client } = render();
    await screen.findByText('9', readable);
    const query = client.getQueryCache().find({ queryKey: ['stats'] })!;
    // the interval is an observer option, set by the page's useQuery
    const interval = query.observers[0].options.refetchInterval as (q: typeof query) => number;
    expect(interval(query)).toBe(5_000);
    query.setData({ ...stats, by_status: { ...stats.by_status, uploading: 0, processing: 0 } });
    expect(interval(query)).toBe(15_000);
  });

  it('gives the latest upload rows the same focus ring as buttons', async () => {
    render();
    const link = await screen.findByRole('link', { name: /Big Buck Bunny/ });
    expect(link).toHaveClass('focus-visible:ring-3', 'focus-visible:ring-ring/50', 'outline-none');
  });

  it('offers a retry on a failed upload row', async () => {
    const failedAsset = { ...assets.data[0], status: 'failed' };
    routes['GET /api/v1/assets'] = () => json({ ...assets, data: [failedAsset] });
    routes['POST /api/v1/assets/a1/retry'] = () => json({ stage: 'transcode' }, 202);
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Retry processing Big Buck Bunny' }),
    );
    expect(
      await screen.findByText('Big Buck Bunny: processing restarted from the transcode'),
    ).toBeInTheDocument();
  });

  it('lets the totals be retried after they fail', async () => {
    routes['GET /api/v1/stats'] = () => json({ error: 'Internal Server Error' }, 500);
    render();
    expect(await screen.findByText('Could not load library totals')).toBeInTheDocument();
    routes['GET /api/v1/stats'] = () => json(stats);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('9', readable)).toBeInTheDocument();
    expect(screen.queryByText('Could not load library totals')).not.toBeInTheDocument();
  });

  it('says when the totals last updated', async () => {
    render();
    await screen.findByText('9', readable);
    expect(screen.getByText(/Totals updated just now/)).toBeInTheDocument();
  });

  it('explains drift that is only untracked objects', async () => {
    routes['GET /api/v1/system/status'] = () => json(deploymentStatus);
    routes['GET /api/v1/reconciliation'] = () =>
      json({ ...deploymentRun, missing_count: 0, missing_ids: [], orphan_count: 16 });
    render(true);
    const run = (await screen.findByText('Reconciliation')).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    const badge = await within(run).findByText('Drift');
    badge.focus();
    expect(
      (await screen.findAllByText(/Nothing is missing\. The indexer holds 16 objects/))[0],
    ).toBeInTheDocument();
  });

  it('holds as many placeholder rows as the list showed last time', async () => {
    localStorage.setItem('sluby-dashboard-latest-rows', '2');
    routes['GET /api/v1/stats'] = () => new Promise<Response>(() => {}) as never;
    routes['GET /api/v1/assets'] = () => new Promise<Response>(() => {}) as never;
    render();
    const card = (await screen.findByText('Latest uploads')).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    expect(card.querySelectorAll('[data-slot="card-content"] .py-2\\.5')).toHaveLength(2);
    localStorage.removeItem('sluby-dashboard-latest-rows');
  });
});
