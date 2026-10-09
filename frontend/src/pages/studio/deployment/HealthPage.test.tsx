import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import HealthPage from './HealthPage';

const status = {
  scope: 'deployment',
  status: 'degraded',
  checked_at: '2026-10-02T00:00:00.000Z',
  version: '0.2.0',
  uptime_seconds: 3600,
  database: { ok: true, latency_ms: 2 },
  redis: { ok: true, latency_ms: 1 },
  indexer: {
    ok: false,
    latency_ms: 30,
    error: 'indexer account is not ready yet',
    url: 'https://sia.storage',
    network: 'mainnet',
    hosts: { total: 213, good_for_upload: 193, countries: 45 },
    account: null,
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      jsonFetch({
        '/api/v1/system/status': status,
        '/api/v1/stats': {
          total: 1,
          by_status: { created: 0, uploading: 0, processing: 0, ready: 1, failed: 0 },
          stored_bytes: 1000,
          ready_duration_ms: 1000,
          object_count: 3,
        },
        '/api/v1/reconciliation': () => new Response('{"error":"none"}', { status: 404 }),
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('HealthPage', () => {
  it('shows the overall verdict, the probes and the operator cards', async () => {
    renderPage(
      <WithSession operator>
        <HealthPage />
      </WithSession>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Health' })).toBeInTheDocument();
    // the header's verdict and the status card's
    expect(await screen.findAllByText('Degraded')).toHaveLength(2);
    expect(screen.getByText('indexer account is not ready yet')).toBeInTheDocument();
    expect(await screen.findByText('Storage usage')).toBeInTheDocument();
  });
});
