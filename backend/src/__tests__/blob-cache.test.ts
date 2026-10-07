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
  getSmallObject,
  warmObjects,
  getCacheStats,
  peekCachedObject,
  CACHEABLE_OBJECT_MAX_BYTES,
} from '../storage/blob-manager.js';
import type { ObjectHandle } from '../storage/sia-client.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

/** A handle over bytes in memory, read in chunks like the sdk stream. */
function handleOf(bytes: Uint8Array, size = bytes.length): ObjectHandle {
  return {
    id: 'x',
    size,
    read: vi.fn((range?: { offset: number; length: number }) => {
      const start = range?.offset ?? 0;
      const end = range ? start + range.length : bytes.length;
      const slice = bytes.subarray(start, end);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < slice.length; i += 2) controller.enqueue(slice.subarray(i, i + 2));
          controller.close();
        },
      });
    }),
  };
}

const opener = (bytes: Uint8Array) => vi.fn(async () => handleOf(bytes));

describe('getSmallObject cache status', () => {
  it('returns MISS and fetches on first access, HIT without fetching on repeat', async () => {
    const open = opener(new Uint8Array([1, 2, 3]));

    const first = await getSmallObject('obj-hitmiss-1', { open });
    expect(first).toMatchObject({ kind: 'cached', status: 'MISS' });
    expect(first.kind === 'cached' && Array.from(first.data)).toEqual([1, 2, 3]);

    const second = await getSmallObject('obj-hitmiss-1', { open });
    expect(second).toMatchObject({ kind: 'cached', status: 'HIT' });
    expect(second.kind === 'cached' && Array.from(second.data)).toEqual([1, 2, 3]);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps manifest and object caches separate', async () => {
    const open = opener(new Uint8Array([7]));

    // Same id, different cache namespace: both should MISS independently.
    const a = await getSmallObject('obj-ns-1', { isManifest: false, open });
    const b = await getSmallObject('obj-ns-1', { isManifest: true, open });

    expect(a).toMatchObject({ status: 'MISS' });
    expect(b).toMatchObject({ status: 'MISS' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch between concurrent misses on the same object', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const open = vi.fn(async () => {
      await gate;
      return handleOf(new Uint8Array([5, 6]));
    });

    const pending = Array.from({ length: 5 }, () => getSmallObject('obj-coalesce-1', { open }));
    release();
    const results = await Promise.all(pending);

    expect(open).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.kind === 'cached' && r.status === 'MISS')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'cached' && r.status === 'HIT')).toHaveLength(4);
  });

  it('never buffers or caches an object over the size limit', async () => {
    const size = CACHEABLE_OBJECT_MAX_BYTES + 1;
    // the handle claims the size without holding the bytes
    const handle = handleOf(new Uint8Array(0), size);
    const open = vi.fn(async () => handle);

    const result = await getSmallObject('obj-large-1', { open });

    expect(result).toEqual({ kind: 'large', handle });
    expect(handle.read).not.toHaveBeenCalled();
    expect(peekCachedObject('obj-large-1')).toBeUndefined();
  });

  it('refuses a stream that ends short of the object size', async () => {
    const open = vi.fn(async () => handleOf(new Uint8Array([1, 2]), 5));
    await expect(getSmallObject('obj-short-1', { open })).rejects.toThrow(/ended at 2 of 5/);
    expect(peekCachedObject('obj-short-1')).toBeUndefined();
  });
});

describe('warmObjects', () => {
  it('prefetches uncached objects into the cache and returns how many warmed', async () => {
    const open = opener(new Uint8Array([9]));

    const warmed = await warmObjects(['warm-a', 'warm-b'], { open });

    expect(warmed).toBe(2);
    expect(open).toHaveBeenCalledTimes(2);

    // subsequently served as a HIT
    const r = await getSmallObject('warm-a', { open });
    expect(r).toMatchObject({ status: 'HIT' });
  });

  it('skips objects already in the cache', async () => {
    const open = opener(new Uint8Array([9]));
    await warmObjects(['warm-c'], { open });
    open.mockClear();

    const warmed = await warmObjects(['warm-c'], { open });

    expect(warmed).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not count an object too large to cache as warmed', async () => {
    const open = vi.fn(async () => handleOf(new Uint8Array(0), CACHEABLE_OBJECT_MAX_BYTES + 1));
    expect(await warmObjects(['warm-large'], { open })).toBe(0);
  });

  it('does not throw if an individual prefetch fails', async () => {
    const open = vi
      .fn()
      .mockResolvedValueOnce(handleOf(new Uint8Array([1])))
      .mockRejectedValueOnce(new Error('sia down'));

    const warmed = await warmObjects(['warm-ok', 'warm-bad'], { open });

    // one succeeded, one failed but was swallowed
    expect(warmed).toBe(1);
  });
});

describe('getCacheStats', () => {
  it('increments misses by exactly 1 on a MISS and hits by exactly 1 on a HIT', async () => {
    const open = opener(new Uint8Array([4, 2]));
    const before = getCacheStats();

    // Exactly one MISS on an id no other test in this file uses.
    const miss = await getSmallObject('stats-delta-1', { open });
    expect(miss).toMatchObject({ status: 'MISS' });

    const afterMiss = getCacheStats();
    expect(afterMiss.misses).toBe(before.misses + 1);
    expect(afterMiss.hits).toBe(before.hits);

    // ...followed by exactly one HIT on the same id.
    const hit = await getSmallObject('stats-delta-1', { open });
    expect(hit).toMatchObject({ status: 'HIT' });

    const afterHit = getCacheStats();
    expect(afterHit.hits).toBe(before.hits + 1);
    expect(afterHit.misses).toBe(before.misses + 1);

    // The HIT must have been served from RAM, not re-fetched.
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('counts a manifest-namespace read against the same counters', async () => {
    const open = opener(new Uint8Array([1]));
    const before = getCacheStats();

    await getSmallObject('stats-delta-manifest-1', { isManifest: true, open });
    await getSmallObject('stats-delta-manifest-1', { isManifest: true, open });

    const after = getCacheStats();
    expect(after.misses).toBe(before.misses + 1);
    expect(after.hits).toBe(before.hits + 1);
  });

  it('reports per-namespace item counts and the configured max size', async () => {
    const open = opener(new Uint8Array([1, 2, 3, 4, 5]));
    const before = getCacheStats();

    await getSmallObject('stats-items-obj-1', { open });
    await getSmallObject('stats-items-man-1', { isManifest: true, open });

    const after = getCacheStats();
    expect(after.object.items).toBe(before.object.items + 1);
    expect(after.manifest.items).toBe(before.manifest.items + 1);
    // The object cache is byte-bounded and tracks the size it has admitted.
    expect(after.object.size).toBe((before.object.size ?? 0) + 5);
    expect(after.object.maxSize).toBe(256 * 1024 * 1024);
  });
});
