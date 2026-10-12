import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotFromResponse } from '@/lib/metrics';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { WithSession } from '@/test/session';
import HealthPage from './HealthPage';

const tls =
  'request to https://sia.storage/api/v2/account failed, reason: unable_to_verify_leaf_signature';

const status = {
  scope: 'deployment',
  status: 'degraded',
  checked_at: '2026-10-02T00:00:00.000Z',
  version: '0.2.0',
  uptime_seconds: 3 * 3600 + 43 * 60,
  database: { ok: true, latency_ms: 2 },
  redis: { ok: true, latency_ms: 1 },
  indexer: {
    ok: false,
    latency_ms: 30,
    error: tls,
    url: 'https://sia.storage/api',
    network: 'mainnet',
    hosts: { total: 213, good_for_upload: 203, countries: 1 },
    account: {
      account_key: 'ed25519:60e8c6f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d52c5b',
      ready: true,
      app_name: 'Sluby',
      pinned_data: 545_000_000,
      pinned_size: 1_600_000_000,
      max_pinned_data: 50_000_000_000,
      remaining_storage: 49_000_000_000,
      last_used: '2026-10-01T00:00:00.000Z',
    },
  },
  reconciliation: null,
  cache: {
    hits: 1204,
    misses: 263,
    object_bytes: 100,
    object_max_bytes: 1000,
    object_items: 510,
    manifest_items: 2,
  },
};

const finished = new Date(Date.now() - 41 * 60_000).toISOString();
const started = new Date(Date.now() - 41 * 60_000 - 2_000).toISOString();
const run = {
  scope: 'deployment',
  id: 'r1',
  started_at: started,
  finished_at: finished,
  created_at: started,
  status: 'drift',
  db_object_count: 38,
  indexer_object_count: 54,
  in_sync_count: 38,
  orphan_count: 16,
  missing_count: 0,
  error_message: null,
  missing_ids: [],
  missing_objects: [],
  orphaned_ids: ['o1', 'o2'],
};

const metricsAt = (t: number, bytes: number, depth = 0) => ({
  timestamp: new Date(t).toISOString(),
  metrics: [
    { name: 'sluby_redis_up', type: 'gauge', values: [{ value: 1, labels: {} }] },
    { name: 'sluby_processing_queue_depth', type: 'gauge', values: [{ value: depth, labels: {} }] },
    {
      name: 'sluby_bandwidth_bytes_total',
      type: 'counter',
      values: [{ value: bytes, labels: {} }],
    },
  ],
});

function setup(routes: Record<string, unknown> = {}) {
  const server = jsonFetch({
    '/api/v1/system/status': status,
    '/api/v1/reconciliation': run,
    '/api/v1/metrics': metricsAt(Date.parse('2026-10-07T12:00:00.000Z'), 0, 3),
    ...routes,
  });
  vi.stubGlobal('fetch', vi.fn(server));
  const view = renderPage(
    <WithSession operator>
      <HealthPage />
    </WithSession>,
  );
  return Object.assign(server, { client: view.client });
}

afterEach(() => vi.unstubAllGlobals());

const card = (title: string) =>
  screen
    .getByRole('heading', { level: 2, name: title })
    .closest('[data-slot="card"]') as HTMLElement;

const service = (name: string) =>
  within(screen.getByRole('list', { name: 'Services' }))
    .getByText(name)
    .closest('li') as HTMLElement;

describe('HealthPage', () => {
  it('leads with the overall verdict, when it was checked and how often it refreshes', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Health' })).toBeInTheDocument();
    const verdict = await screen.findByText('Sia indexer needs attention');
    expect(verdict.closest('[data-tone]')).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByText(/^Checked \d+ s ago\. Refreshes every 20 s\./)).toBeInTheDocument();
    expect(
      screen.getByText(/Backend v0\.2\.0, running for 3 hours 43 minutes\./),
    ).toBeInTheDocument();
  });

  it('says all services work when the server says ok', async () => {
    setup({ '/api/v1/system/status': { ...status, status: 'ok' } });
    const verdict = await screen.findByText('All services working');
    expect(verdict.closest('[data-tone]')).toHaveAttribute('data-tone', 'ok');
  });

  it('draws four service cards with a dot, a name and a detail line, the raw error under Details', async () => {
    setup();
    const services = await screen.findByRole('list', { name: 'Services' });
    const cards = within(services).getAllByRole('listitem');
    expect(cards.map((c) => c.querySelector('span')?.textContent)).toEqual([
      'Database',
      'Queue',
      'Sia indexer',
      'Stream cache',
    ]);
    expect(service('Database')).toHaveTextContent('PostgreSQL · 2 ms');
    expect(service('Database')).toHaveAttribute('data-tone', 'ok');
    // the waiting count comes from the metrics, once they are in
    await waitFor(() => expect(service('Queue')).toHaveTextContent('Redis · 1 ms · 3 waiting'));
    const indexer = service('Sia indexer');
    expect(indexer).toHaveTextContent('sia.storage · mainnet · Not working');
    expect(indexer).toHaveAttribute('data-tone', 'bad');
    expect(within(indexer).getByText(tls).closest('details')).not.toHaveAttribute('open');
    // 1,204 hits of 1,467 lookups
    expect(service('Stream cache')).toHaveTextContent('100 B of 1 KB · 82% hits');
  });

  it('leaves the waiting count out while the queue cannot be read', async () => {
    setup({
      '/api/v1/metrics': {
        timestamp: '2026-10-07T12:00:00.000Z',
        metrics: [{ name: 'sluby_redis_up', type: 'gauge', values: [{ value: 0, labels: {} }] }],
      },
    });
    await screen.findByRole('list', { name: 'Services' });
    await waitFor(() => expect(card('Bytes streamed')).toHaveTextContent('Collecting samples'));
    expect(service('Queue')).toHaveTextContent(/^QueueRedis · 1 ms$/);
  });

  it('shows the Sia account: stored against the limit, hosts, app and a shortened key', async () => {
    setup();
    await screen.findByText('545 MB');
    const account = card('Sia account');
    expect(account).toHaveTextContent('Stored545 MB of 50 GB');
    expect(
      within(account).getByRole('progressbar', { name: 'Sia storage used' }),
    ).toBeInTheDocument();
    const value = (label: string) =>
      within(account).getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(value('Hosts')).toHaveTextContent('203 of 213 good for upload, 1 country');
    expect(value('App')).toHaveTextContent('Sluby');
    expect(value('Account key')).toHaveTextContent('ed25519:60e8c6…2c5b');
    expect(value('Account key')).toHaveClass('font-mono');
  });

  it('explains the check with its last run, two tiles and the unused files on request', async () => {
    setup();
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    const check = card('Storage check');
    expect(check).toHaveTextContent(
      'Compares your videos with what Sia holds. Last run 41 min ago, took 2 s.',
    );
    const tiles = check.querySelectorAll('[data-slot="check-tile"]');
    expect([...tiles].map((t) => t.textContent)).toEqual([
      '0missing files',
      '16unused files still stored',
    ]);
    // only a count that is not zero takes the tone at its edge
    expect(tiles[0]).not.toHaveAttribute('data-tone');
    expect(tiles[1]).toHaveAttribute('data-tone', 'warn');
    const summary = within(check).getByText('Show unused files');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    const list = within(check).getByRole('list', { name: 'Unused files' });
    expect(list).toHaveTextContent('o1o2');
    // it scrolls, and holds nothing focusable, so Safari's keyboard needs the list itself
    expect(list).toHaveAttribute('tabindex', '0');
    expect(
      within(check).getByRole('button', { name: 'Copy unused files IDs' }),
    ).toBeInTheDocument();
    // nothing is missing, so there is nothing to list
    expect(within(check).queryByText('Show missing files')).not.toBeInTheDocument();
  });

  it('lists missing files under the videos that use them, each linked', async () => {
    setup({
      '/api/v1/reconciliation': {
        ...run,
        missing_count: 3,
        missing_ids: ['m1', 'm2', 'm3'],
        missing_objects: [
          { object_id: 'm1', video_asset_id: 'a1', title: 'Big Buck Bunny' },
          { object_id: 'm2', video_asset_id: 'a1', title: 'Big Buck Bunny' },
          { object_id: 'm3', video_asset_id: null, title: null },
        ],
      },
    });
    await userEvent.click(await screen.findByText('Show missing files'));
    const check = card('Storage check');
    expect(check.querySelector('[data-slot="check-tile"]')).toHaveAttribute('data-tone', 'bad');
    const list = within(check).getByRole('list', { name: 'Missing files' });
    const video = within(list).getByRole('link', { name: 'Big Buck Bunny' });
    expect(video).toHaveAttribute('href', '/studio/videos/a1');
    const entry = video.closest('li')!;
    expect(entry).toHaveTextContent('2 files');
    expect(entry).toHaveTextContent('m1');
    expect(entry).toHaveTextContent('m2');
    expect(within(list).getByText('Video not found').closest('li')).toHaveTextContent('m3');
  });

  it('says why a failed check stopped', async () => {
    setup({
      '/api/v1/reconciliation': { ...run, status: 'failed', error_message: 'indexer timed out' },
    });
    expect(await screen.findByText('Check failed')).toBeInTheDocument();
    const check = card('Storage check');
    expect(within(check).getByText(/stopped before it finished/)).toBeInTheDocument();
    expect(within(check).getByText('indexer timed out').closest('details')).toBeInTheDocument();
    expect(check.querySelector('[data-slot="check-tile"]')).toBeNull();
  });

  it('starts a storage check', async () => {
    const server = setup({
      'POST /api/v1/reconciliation/run': reply(202, { enqueued: true, already_pending: false }),
    });
    await screen.findByText('Needs attention');
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Storage check started')).toBeInTheDocument();
    expect(server.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('turns a failed start into a sentence, not a raw message', async () => {
    setup({ 'POST /api/v1/reconciliation/run': reply(500, { error: 'boom' }) });
    await screen.findByText('Needs attention');
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(
      await screen.findByText(/^Could not start the storage check\. The server ran into a problem/),
    ).toBeInTheDocument();
  });

  it('charts the bytes streamed from the metrics samples, the peak in the accent', async () => {
    const t0 = Date.parse('2026-10-07T12:00:00.000Z');
    const { client } = setup();
    await screen.findByText('Needs attention');
    // three samples 10 s apart: 200 kB then 100 kB, so the first rate is the peak
    const samples = [
      metricsAt(t0, 0),
      metricsAt(t0 + 10_000, 2_000_000),
      metricsAt(t0 + 20_000, 3_000_000),
    ].map((r) => snapshotFromResponse(r));
    await act(async () => {
      client.setQueryData(['metrics'], { latest: samples[2], samples });
    });
    const bytes = card('Bytes streamed');
    const chart = await within(bytes).findByRole('img', { name: /^Bytes streamed per second/ });
    const bars = chart.querySelectorAll('[data-slot="bar"]');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('data-peak');
    expect(bars[0]).toHaveClass('bg-primary', 'hover:bg-primary');
    expect(bars[1]).not.toHaveAttribute('data-peak');
    expect(bars[1]).toHaveClass('bg-primary/45', 'hover:bg-primary');
    expect(bars[1]).toHaveStyle({ height: '50%' });
    expect(chart).toHaveAccessibleName(
      'Bytes streamed per second over the last 20 seconds, now 100 KB/s, peak 200 KB/s',
    );
    expect(bytes).toHaveTextContent('Last 20 seconds');
    expect(bytes).toHaveTextContent('20 seconds agoPeak 200 KB/sNow');
    expect(within(bytes).getByRole('link', { name: 'Open metrics' })).toHaveAttribute(
      'href',
      '/studio/deployment/metrics',
    );
  });

  it('says it is collecting samples before there are two', async () => {
    setup();
    await screen.findByText('Needs attention');
    expect(await within(card('Bytes streamed')).findByText('Collecting samples')).toBeVisible();
  });

  it('draws the loading cards first, then the real ones in one step', async () => {
    let answer: (r: Response) => void = () => {};
    setup({
      '/api/v1/reconciliation': () =>
        new Promise<Response>((r) => {
          answer = r;
        }),
    });
    await screen.findByText(/Not working/, undefined, { timeout: 50 }).catch(() => {});
    // the status is in, the check is not: still the loading draw
    expect(screen.queryByText(/Not working/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
    await act(async () =>
      answer(
        new Response(JSON.stringify(run), { headers: { 'content-type': 'application/json' } }),
      ),
    );
    expect(await screen.findByText(/Not working/)).toBeInTheDocument();
  });

  it('says when no check has run yet', async () => {
    setup({ '/api/v1/reconciliation': reply(404, { error: 'none' }) });
    expect(await screen.findByText(/No check has run yet/)).toBeInTheDocument();
  });

  it('shows one error with Try again when the status cannot load', async () => {
    setup({ '/api/v1/system/status': reply(500, { error: 'Internal Server Error' }) });
    expect(await screen.findByText("Could not load this server's status")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(
      screen.queryByText('Internal Server Error', { selector: 'p:not(details p)' }),
    ).toBeNull();
    // the storage check does not depend on it
    expect(card('Storage check')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Services' })).not.toBeInTheDocument();
  });
});
