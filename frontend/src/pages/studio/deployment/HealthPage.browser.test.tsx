import '@/index.css';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import HealthPage from './HealthPage';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
interface BrowserContext {
  page: { viewport(width: number, height: number): Promise<void> };
}
const browser = () => import('vitest/browser' as string) as Promise<BrowserContext>;

const status = {
  scope: 'deployment',
  status: 'ok',
  checked_at: '2026-10-07T12:00:00.000Z',
  version: '0.2.0',
  uptime_seconds: 3600,
  database: { ok: true, latency_ms: 1 },
  redis: { ok: true, latency_ms: 1 },
  indexer: {
    ok: true,
    latency_ms: 159,
    url: 'https://sia.storage',
    network: 'mainnet',
    hosts: { total: 213, good_for_upload: 202, countries: 45 },
    account: {
      account_key: 'ed25519:60e8c6f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d52c5b',
      ready: true,
      app_name: 'Sluby',
      pinned_data: 2_600_000_000,
      pinned_size: 7_800_000_000,
      max_pinned_data: 50_000_000_000,
      remaining_storage: 47_400_000_000,
      last_used: '2026-10-07T11:00:00.000Z',
    },
  },
  reconciliation: null,
  cache: {
    hits: 910,
    misses: 90,
    object_bytes: 48_000_000,
    object_max_bytes: 256_000_000,
    object_items: 40,
    manifest_items: 4,
  },
};

const finished = new Date(Date.now() - 41 * 60_000).toISOString();
const run = {
  scope: 'deployment',
  id: 'r1',
  started_at: finished,
  finished_at: finished,
  created_at: finished,
  status: 'drift',
  db_object_count: 38,
  indexer_object_count: 41,
  in_sync_count: 38,
  orphan_count: 3,
  missing_count: 0,
  error_message: null,
  missing_ids: [],
  missing_objects: [],
  orphaned_ids: ['7f32408a00000000000000000000c11e', '1951be02000000000000000000009d40'],
};

const metricsAt = (t: number, bytes: number) => ({
  timestamp: new Date(t).toISOString(),
  metrics: [
    {
      name: 'sluby_bandwidth_bytes_total',
      type: 'counter',
      values: [{ value: bytes, labels: {} }],
    },
  ],
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/system/status')) return json(status);
    if (url.endsWith('/reconciliation')) return json(run);
    if (url.endsWith('/metrics')) return json(metricsAt(Date.parse(status.checked_at), 0));
    throw new Error(`unmocked ${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
});

async function draw(width: number) {
  await (await browser()).page.viewport(width, 1000);
  const view = renderPage(
    <WithSession admin>
      <HealthPage />
    </WithSession>,
  );
  await screen.findByText('Needs attention', {}, { timeout: 5_000 });
  return view;
}

const top = (el: Element) => Math.round(el.getBoundingClientRect().top);
const region = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).closest('section')!;

describe('Health in a real browser', () => {
  it('puts the four services in a row and the two account cards side by side at 1440 px', async () => {
    await draw(1440);
    const cards = within(screen.getByRole('list', { name: 'Services' })).getAllByRole('listitem');
    expect(new Set(cards.map(top)).size).toBe(1);
    expect(top(region('Sia account'))).toBe(top(region('Storage check')));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1440);
  });

  it('stacks everything at phone width without scrolling sideways', async () => {
    await draw(390);
    const cards = within(screen.getByRole('list', { name: 'Services' })).getAllByRole('listitem');
    expect(new Set(cards.map(top)).size).toBe(4);
    expect(top(region('Storage check'))).toBeGreaterThan(top(region('Sia account')));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it('follows the dark theme: the cards take the dark surface', async () => {
    await draw(1440);
    const card = region('Sia account');
    const light = getComputedStyle(card).backgroundColor;
    document.documentElement.classList.add('dark');
    await vi.waitFor(() => expect(getComputedStyle(card).backgroundColor).not.toBe(light));
  });
});
