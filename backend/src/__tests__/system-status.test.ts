import { describe, it, expect, vi } from 'vitest';
import {
  collectSystemStatus,
  createCachedSystemStatus,
  type SystemStatusDeps,
} from '../system/status.js';

const account = {
  accountKey: 'ak',
  ready: true,
  appName: 'Sluby',
  pinnedData: 100,
  pinnedSize: 300,
  maxPinnedData: 1000,
  remainingStorage: 900,
  lastUsed: '2026-10-01T00:00:00.000Z',
};

function deps(overrides: Partial<SystemStatusDeps> = {}): SystemStatusDeps {
  return {
    version: '1.2.3',
    startedAt: new Date(0),
    indexerUrl: 'https://sia.storage',
    network: 'mainnet',
    pingDatabase: vi.fn().mockResolvedValue(undefined),
    pingRedis: vi.fn().mockResolvedValue(undefined),
    getAccount: vi.fn().mockResolvedValue(account),
    listHosts: vi.fn().mockResolvedValue([
      { publicKey: 'a', countryCode: 'DE', latitude: 0, longitude: 0, goodForUpload: true },
      { publicKey: 'b', countryCode: 'DE', latitude: 0, longitude: 0, goodForUpload: false },
      { publicKey: 'c', countryCode: 'US', latitude: 0, longitude: 0, goodForUpload: true },
    ]),
    getLatestReconciliation: vi.fn().mockResolvedValue(null),
    getCacheStats: () => ({
      hits: 3,
      misses: 1,
      objectBytes: 10,
      objectMaxBytes: 100,
      objectItems: 2,
      manifestItems: 1,
    }),
    now: () => 10_000,
    ...overrides,
  };
}

describe('collectSystemStatus', () => {
  it('reports ok with real account usage and host pool numbers', async () => {
    const s = await collectSystemStatus(deps());
    expect(s.status).toBe('ok');
    expect(s.uptimeSeconds).toBe(10);
    expect(s.indexer.ok).toBe(true);
    expect(s.indexer.account).toEqual(account);
    expect(s.indexer.hosts).toEqual({ total: 3, goodForUpload: 2, countries: 2 });
    expect(s.cache.hits).toBe(3);
  });

  it('is degraded, with the reason, when the indexer fails', async () => {
    const s = await collectSystemStatus(
      deps({ getAccount: vi.fn().mockRejectedValue(new Error('connect refused')) }),
    );
    expect(s.status).toBe('degraded');
    expect(s.indexer.ok).toBe(false);
    expect(s.indexer.error).toBe('connect refused');
    expect(s.indexer.account).toBeNull();
  });

  it('is degraded while the indexer account is not ready', async () => {
    const s = await collectSystemStatus(
      deps({ getAccount: vi.fn().mockResolvedValue({ ...account, ready: false }) }),
    );
    expect(s.status).toBe('degraded');
    expect(s.indexer.error).toMatch(/not ready/);
  });

  it('is down when the database fails', async () => {
    const s = await collectSystemStatus(
      deps({ pingDatabase: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }),
    );
    expect(s.status).toBe('down');
    expect(s.database).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });

  it('times out a hung probe instead of hanging the report', async () => {
    const s = await collectSystemStatus(
      deps({
        pingRedis: () => new Promise(() => {}),
        timeoutMs: 20,
        now: Date.now,
      }),
    );
    expect(s.status).toBe('down');
    expect(s.redis.error).toMatch(/timed out/);
  });
});

describe('createCachedSystemStatus', () => {
  it('shares one collection between concurrent callers and caches it', async () => {
    let t = 0;
    const d = deps({ now: () => t });
    const get = createCachedSystemStatus(d, 1000);

    await Promise.all([get(), get(), get()]);
    expect(d.getAccount).toHaveBeenCalledTimes(1);

    t = 500;
    await get();
    expect(d.getAccount).toHaveBeenCalledTimes(1);

    t = 1500;
    await get();
    expect(d.getAccount).toHaveBeenCalledTimes(2);
  });
});
