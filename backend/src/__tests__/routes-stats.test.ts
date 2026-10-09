import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createStatsRoutes, type StatsRouteDeps } from '../api/routes/stats.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';
import { PLATFORM_ADDRESS } from '../api/ownership.js';

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
      getDailyPlays: vi.fn().mockResolvedValue([]),
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

  const app = (key: typeof readKey & { operator?: boolean } = readKey) =>
    withApiKey(createTestApp(createStatsRoutes(deps)), key);

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

  it('GET /system/status gives a tenant a health summary only', async () => {
    const res = await request(app()).get('/system/status');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      scope: 'account',
      status: 'degraded',
      checked_at: '2026-10-02T00:00:00.000Z',
      version: '0.1.0',
      database: { ok: true, latency_ms: 1 },
      redis: { ok: true, latency_ms: 1 },
      indexer: { ok: false, latency_ms: 40, network: 'mainnet', hosts: null },
    });
  });

  it('GET /system/status reports everything, in snake_case, to the platform identity', async () => {
    const res = await request(app({ ...readKey, creatorAddress: PLATFORM_ADDRESS })).get(
      '/system/status',
    );
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.scope).toBe('deployment');
    expect(res.body.status).toBe('degraded');
    expect(res.body.uptime_seconds).toBe(5);
    expect(res.body.indexer.url).toBe('https://sia.storage');
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

  it('GET /system/status reports everything to an operator, whose stats stay its own', async () => {
    const operator = app({ ...readKey, operator: true });
    const status = await request(operator).get('/system/status');
    expect(status.body.scope).toBe('deployment');
    expect(status.body.indexer.url).toBe('https://sia.storage');
    expect(status.body.cache.hits).toBe(1);

    await request(operator).get('/stats');
    expect(deps.getAssetStats).toHaveBeenCalledWith('github:owner');
  });

  it('requires the read scope', async () => {
    const res = await request(app({ ...readKey, scopes: ['upload'] })).get('/stats');
    expect(res.status).toBe(403);
  });

  describe('GET /stats/usage', () => {
    const app = (key = readKey) => withApiKey(createTestApp(createStatsRoutes(deps)), key);

    it('answers plays per UTC day, oldest first, zero-filled, with the total', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-09T15:00:00Z'), toFake: ['Date'] });
      vi.mocked(deps.getDailyPlays).mockResolvedValue([
        { day: '2026-10-07', plays: 4 },
        { day: '2026-10-09', plays: 1 },
      ]);
      const res = await request(app()).get('/stats/usage').query({ days: 3 });
      vi.useRealTimers();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        days: [
          { date: '2026-10-07', plays: 4 },
          { date: '2026-10-08', plays: 0 },
          { date: '2026-10-09', plays: 1 },
        ],
        total: 5,
      });
      expect(deps.getDailyPlays).toHaveBeenCalledWith('github:owner', '2026-10-07');
    });

    it('covers 30 days by default, and every account for the platform key', async () => {
      const res = await request(app({ ...readKey, creatorAddress: PLATFORM_ADDRESS })).get(
        '/stats/usage',
      );
      expect(res.body.days).toHaveLength(30);
      expect(res.body.total).toBe(0);
      expect(vi.mocked(deps.getDailyPlays).mock.calls[0][0]).toBeUndefined();
    });

    it.each(['0', '91', 'x', '1.5'])('rejects days=%s', async (days) => {
      const res = await request(app()).get('/stats/usage').query({ days });
      expect(res.status).toBe(400);
    });

    it('needs read', async () => {
      const res = await request(app({ ...readKey, scopes: ['upload'] })).get('/stats/usage');
      expect(res.status).toBe(403);
    });
  });
});
