import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createStatsRoutes, type StatsRouteDeps } from '../api/routes/stats.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const readKey = {
  id: 'k',
  name: 'k',
  scopes: ['read'],
  rateLimit: 100,
  creatorAddress: 'github:owner',
};

describe('stats routes', () => {
  let deps: StatsRouteDeps;

  beforeEach(() => {
    deps = {
      getAssetStats: vi.fn().mockResolvedValue({
        total: 3,
        byStatus: { created: 0, uploading: 0, processing: 1, ready: 2, failed: 0 },
        storedBytes: 1234,
        readyDurationMs: 60000,
        objectCount: 12,
      }),
      getSystemStatus: vi.fn().mockResolvedValue({
        status: 'degraded',
        checkedAt: '2026-10-02T00:00:00.000Z',
        version: '0.1.0',
        uptimeSeconds: 5,
        database: { ok: true, latencyMs: 1 },
        redis: { ok: true, latencyMs: 1 },
        indexer: {
          ok: false,
          latencyMs: 40,
          error: 'indexer account is not ready yet',
          url: 'https://sia.storage',
          network: 'mainnet',
          account: null,
          hosts: null,
        },
        reconciliation: null,
        cache: {
          hits: 1,
          misses: 2,
          objectBytes: 3,
          objectMaxBytes: 4,
          objectItems: 5,
          manifestItems: 6,
        },
      }),
    };
  });

  const app = (key = readKey) => withApiKey(createTestApp(createStatsRoutes(deps)), key);

  it('GET /stats scopes totals to the caller', async () => {
    const res = await request(app()).get('/stats');
    expect(res.status).toBe(200);
    expect(deps.getAssetStats).toHaveBeenCalledWith('github:owner');
    expect(res.body).toEqual({
      total: 3,
      by_status: { created: 0, uploading: 0, processing: 1, ready: 2, failed: 0 },
      stored_bytes: 1234,
      ready_duration_ms: 60000,
      object_count: 12,
    });
  });

  it('GET /system/status reports probes in snake_case and is not cacheable', async () => {
    const res = await request(app()).get('/system/status');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.status).toBe('degraded');
    expect(res.body.indexer).toMatchObject({
      ok: false,
      error: 'indexer account is not ready yet',
      latency_ms: 40,
      account: null,
    });
    expect(res.body.cache).toEqual({
      hits: 1,
      misses: 2,
      object_bytes: 3,
      object_max_bytes: 4,
      object_items: 5,
      manifest_items: 6,
    });
  });

  it('requires the read scope', async () => {
    const res = await request(app({ ...readKey, scopes: ['upload'] })).get('/stats');
    expect(res.status).toBe(403);
  });
});
