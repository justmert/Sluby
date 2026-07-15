import { describe, it, expect, vi } from 'vitest';
import {
  getCachedObject,
  warmObjects,
  getCacheStats,
} from '../storage/blob-manager.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

describe('getCachedObject cache status', () => {
  it('returns MISS and fetches on first access, HIT without fetching on repeat', async () => {
    const fetch = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

    const first = await getCachedObject('obj-hitmiss-1', { fetch });
    expect(first.status).toBe('MISS');
    expect(Array.from(first.data)).toEqual([1, 2, 3]);

    const second = await getCachedObject('obj-hitmiss-1', { fetch });
    expect(second.status).toBe('HIT');
    expect(Array.from(second.data)).toEqual([1, 2, 3]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps manifest and object caches separate', async () => {
    const fetch = vi.fn().mockResolvedValue(new Uint8Array([7]));

    // Same id, different cache namespace — both should MISS independently.
    const a = await getCachedObject('obj-ns-1', { isManifest: false, fetch });
    const b = await getCachedObject('obj-ns-1', { isManifest: true, fetch });

    expect(a.status).toBe('MISS');
    expect(b.status).toBe('MISS');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('warmObjects', () => {
  it('prefetches uncached objects into the cache and returns how many warmed', async () => {
    const fetch = vi.fn().mockResolvedValue(new Uint8Array([9]));

    const warmed = await warmObjects(['warm-a', 'warm-b'], { fetch });

    expect(warmed).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);

    // subsequently served as a HIT
    const r = await getCachedObject('warm-a', { fetch });
    expect(r.status).toBe('HIT');
  });

  it('skips objects already in the cache', async () => {
    const fetch = vi.fn().mockResolvedValue(new Uint8Array([9]));
    await warmObjects(['warm-c'], { fetch });
    fetch.mockClear();

    const warmed = await warmObjects(['warm-c'], { fetch });

    expect(warmed).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not throw if an individual prefetch fails', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockRejectedValueOnce(new Error('sia down'));

    const warmed = await warmObjects(['warm-ok', 'warm-bad'], { fetch });

    // one succeeded, one failed but was swallowed
    expect(warmed).toBe(1);
  });
});

describe('getCacheStats', () => {
  it('exposes cumulative hit and miss counters', async () => {
    const stats = getCacheStats();
    expect(typeof stats.hits).toBe('number');
    expect(typeof stats.misses).toBe('number');
  });
});
