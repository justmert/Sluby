import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    url: 'https://sia.storage',
    network: 'mainnet',
    hosts: { total: 213, good_for_upload: 203, countries: 1 },
    account: {
      account_key: 'ed25519:abc',
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

const finished = new Date(Date.now() - 3 * 60_000).toISOString();
const run = {
  scope: 'deployment',
  id: 'r1',
  started_at: finished,
  finished_at: finished,
  created_at: finished,
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

function setup(routes: Record<string, unknown> = {}) {
  const server = jsonFetch({
    '/api/v1/system/status': status,
    '/api/v1/reconciliation': run,
    ...routes,
  });
  vi.stubGlobal('fetch', vi.fn(server));
  renderPage(
    <WithSession operator>
      <HealthPage />
    </WithSession>,
  );
  return server;
}

afterEach(() => vi.unstubAllGlobals());

const card = (title: string) =>
  screen
    .getByRole('heading', { level: 2, name: title })
    .closest('[data-slot="card"]') as HTMLElement;

describe('HealthPage', () => {
  it('leads with the overall verdict and when it was checked', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Health' })).toBeInTheDocument();
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText(/^Checked just now/)).toBeInTheDocument();
  });

  it('names each service, says which one is down in words, and keeps the raw error under Details', async () => {
    setup();
    const services = (await screen.findByRole('list', { name: 'Services' })) as HTMLElement;
    const rows = within(services).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('p')?.textContent)).toEqual([
      'Sia indexer',
      'Database',
      'Job queue',
    ]);
    expect(within(rows[0]).getByText('Not responding')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Not responding').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'danger',
    );
    expect(within(rows[0]).getByText(tls).closest('details')).not.toHaveAttribute('open');
    expect(within(rows[1]).getByText('2 ms')).toBeInTheDocument();
    expect(screen.getByText(/running for 3 hours 43 minutes/)).toBeInTheDocument();
  });

  it('shows the Sia account in plain words, with a singular country', async () => {
    setup();
    await screen.findByText('545 MB');
    const account = card('Sia account');
    expect(within(account).getByText('of 50 GB used')).toBeInTheDocument();
    expect(
      within(account).getByRole('progressbar', { name: 'Sia storage used' }),
    ).toBeInTheDocument();
    expect(within(account).getByText('1.6 GB, with redundancy')).toBeInTheDocument();
    expect(
      within(account).getByText('203 of 213 accept uploads, in 1 country'),
    ).toBeInTheDocument();
    expect(within(account).getByText('Ready')).toBeInTheDocument();
  });

  it('explains a check that only found unused files, inline, and lists them on request', async () => {
    setup();
    await screen.findByText('Checked 3 minutes ago');
    const check = card('Storage check');
    expect(await within(check).findByText('Needs attention')).toBeInTheDocument();
    expect(
      within(check).getByText(/Nothing is missing\. Sia holds 16 files no video uses/),
    ).toBeVisible();
    expect(within(check).getByText('Checked 3 minutes ago')).toBeInTheDocument();
    const toggle = within(check).getByRole('button', { name: 'Show unused files on Sia (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = within(check).getByRole('list', { name: 'Unused files on Sia' });
    expect(list).toHaveTextContent('o1o2');
    // it scrolls, and holds nothing focusable, so Safari's keyboard needs the list itself
    expect(list).toHaveAttribute('tabindex', '0');
    expect(list).toHaveClass('focus-visible:ring-3', 'focus-visible:ring-ring');
    // nothing is missing, so there is nothing to list
    expect(within(check).queryByRole('button', { name: /missing files/ })).not.toBeInTheDocument();
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
    await screen.findByText('Checked 3 minutes ago');
    const check = card('Storage check');
    await userEvent.click(within(check).getByRole('button', { name: 'Show missing files (3)' }));
    const list = within(check).getByRole('list', { name: 'Missing files' });
    const video = within(list).getByRole('link', { name: 'Big Buck Bunny' });
    expect(video).toHaveAttribute('href', '/studio/videos/a1');
    const entry = video.closest('li')!;
    expect(entry).toHaveTextContent('2 files');
    expect(entry).toHaveTextContent('m1');
    expect(entry).toHaveTextContent('m2');
    expect(within(list).getByText('Video not found').closest('li')).toHaveTextContent('m3');
  });

  it('starts a storage check', async () => {
    const server = setup({
      'POST /api/v1/reconciliation/run': reply(202, { enqueued: true, already_pending: false }),
    });
    await screen.findByText('Checked 3 minutes ago');
    // wraps at a large default font instead of running out of the card (1.4.4)
    expect(screen.getByRole('button', { name: 'Check now' })).toHaveClass('whitespace-normal');
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Storage check started')).toBeInTheDocument();
    expect(server.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('turns a failed start into a sentence, not a raw message', async () => {
    setup({ 'POST /api/v1/reconciliation/run': reply(500, { error: 'boom' }) });
    await screen.findByText('Checked 3 minutes ago');
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(
      await screen.findByText(/^Could not start the storage check\. The server ran into a problem/),
    ).toBeInTheDocument();
  });

  it('shows the stream cache figures', async () => {
    setup();
    const cache = await screen.findByText('82%');
    expect(cache).toBeInTheDocument();
    expect(screen.getByText('1,204 / 263')).toBeInTheDocument();
    expect(screen.getByText('510 files, 2 playlists')).toBeInTheDocument();
  });

  it('draws the loading cards first, then the real ones in one step', async () => {
    let answer: (r: Response) => void = () => {};
    setup({
      '/api/v1/reconciliation': () =>
        new Promise<Response>((r) => {
          answer = r;
        }),
    });
    await screen.findByText('Not responding', undefined, { timeout: 50 }).catch(() => {});
    // the status is in, the check is not: still the loading draw
    expect(screen.queryByText('Not responding')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
    await act(async () =>
      answer(
        new Response(JSON.stringify(run), { headers: { 'content-type': 'application/json' } }),
      ),
    );
    expect(await screen.findByText('Not responding')).toBeInTheDocument();
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
  });
});
