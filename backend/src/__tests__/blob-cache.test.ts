/**
 * blob-manager.ts holds its two LRU caches and its hit/miss counters as
 * module-level singletons, and deliberately exposes no reset API. That means
 * cache state LEAKS ACROSS EVERY TEST IN THIS FILE (and would leak across
 * files if another one imported the module).
 *
 * Consequences you must respect when adding cases here:
 *   1. Every object id used below must be GLOBALLY UNIQUE within its cache
 *      namespace, or a "first access" will unexpectedly be a HIT. The one
 *      intentional exception is the namespace-separation test, which reuses
 *      an id precisely because the object and manifest caches are distinct.
 *   2. `getCacheStats().hits` / `.misses` are cumulative and monotonic for
 *      the whole run, so assert on the DELTA around an action, never on an
 *      absolute value.
 * Do not "fix" this by adding a reset export to the source.
 */
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
  it('increments misses by exactly 1 on a MISS and hits by exactly 1 on a HIT', async () => {
    const fetch = vi.fn().mockResolvedValue(new Uint8Array([4, 2]));
    const before = getCacheStats();

    // Exactly one MISS on an id no other test in this file uses.
    const miss = await getCachedObject('stats-delta-1', { fetch });
    expect(miss.status).toBe('MISS');

    const afterMiss = getCacheStats();
    expect(afterMiss.misses).toBe(before.misses + 1);
    expect(afterMiss.hits).toBe(before.hits);

    // ...followed by exactly one HIT on the same id.
    const hit = await getCachedObject('stats-delta-1', { fetch });
    expect(hit.status).toBe('HIT');

    const afterHit = getCacheStats();
    expect(afterHit.hits).toBe(before.hits + 1);
    expect(afterHit.misses).toBe(before.misses + 1);

    // The HIT must have been served from RAM, not re-fetched.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('counts a manifest-namespace read against the same counters', async () => {
    const fetch = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const before = getCacheStats();

    await getCachedObject('stats-delta-manifest-1', { isManifest: true, fetch });
    await getCachedObject('stats-delta-manifest-1', { isManifest: true, fetch });

    const after = getCacheStats();
    expect(after.misses).toBe(before.misses + 1);
    expect(after.hits).toBe(before.hits + 1);
  });

  it('reports per-namespace item counts and the configured max size', async () => {
    const fetch = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5]));
    const before = getCacheStats();

    await getCachedObject('stats-items-obj-1', { fetch });
    await getCachedObject('stats-items-man-1', { isManifest: true, fetch });

    const after = getCacheStats();
    expect(after.object.items).toBe(before.object.items + 1);
    expect(after.manifest.items).toBe(before.manifest.items + 1);
    // The object cache is byte-bounded and tracks the size it has admitted.
    expect(after.object.size).toBe((before.object.size ?? 0) + 5);
    expect(after.object.maxSize).toBeGreaterThan(0);
  });
});
