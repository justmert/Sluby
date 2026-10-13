import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage } from '@/test/render';
import DashboardPage from './DashboardPage';

const stats = {
  total: 7,
  by_status: { created: 0, uploading: 1, processing: 1, ready: 4, failed: 1 },
  stored_bytes: 5 * 1024 * 1024,
  ready_duration_ms: 125_000,
  object_count: 42,
};

const status = {
  status: 'degraded',
  checked_at: '2026-10-02T00:00:00.000Z',
  version: '0.1.0',
  uptime_seconds: 3600,
  database: { ok: true, latency_ms: 2 },
  redis: { ok: true, latency_ms: 1 },
  indexer: {
    ok: false,
    latency_ms: 30,
    error: 'indexer account is not ready yet',
    url: 'https://sia.storage',
    network: 'mainnet',
    account: {
      account_key: 'ak',
      ready: false,
      app_name: 'Sluby',
      pinned_data: 1024 * 1024 * 1024,
      pinned_size: 3 * 1024 * 1024 * 1024,
      max_pinned_data: 50 * 1024 * 1024 * 1024,
      remaining_storage: 49 * 1024 * 1024 * 1024,
      last_used: '2026-10-01T00:00:00.000Z',
    },
    hosts: { total: 40, good_for_upload: 31, countries: 12 },
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
      creator_address: 'github:dev',
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      jsonFetch({
        '/api/v1/stats': stats,
        '/api/v1/system/status': status,
        '/api/v1/assets': assets,
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('DashboardPage', () => {
  it('shows real library totals', async () => {
    renderPage(<DashboardPage />);
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText('4 ready, 2 in progress, 1 failed')).toBeInTheDocument();
    // stat card and the storage card's library row
    expect(screen.getAllByText('5 MB')).toHaveLength(2);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('surfaces a degraded indexer with the reason', async () => {
    renderPage(<DashboardPage />);
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('indexer account is not ready yet')).toBeInTheDocument();
    expect(screen.getByText('31 of 40 accepting uploads, 12 countries')).toBeInTheDocument();
  });

  it('shows account usage and cache hit ratio', async () => {
    renderPage(<DashboardPage />);
    expect(await screen.findByText('1 GB')).toBeInTheDocument();
    expect(screen.getByText('of 50 GB')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('lists the latest uploads from the sdk', async () => {
    renderPage(<DashboardPage />);
    const link = await screen.findByRole('link', { name: /Big Buck Bunny/ });
    expect(link).toHaveAttribute('href', '/studio/assets/a1');
  });
});
