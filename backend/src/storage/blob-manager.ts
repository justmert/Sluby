import { openObject, readExactly, type ObjectHandle } from './sia-client.js';
import { LRUCache } from 'lru-cache';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

/**
 * In-memory cache of small whole objects (manifests, playlists, thumbnails)
 * for the delivery gateway. Objects never change under their id, so entries
 * need no expiry; the access check runs on every request before a cached
 * body is used, so the cache never decides who may read what.
 *
 * Anything over CACHEABLE_OBJECT_MAX_BYTES is never held in memory: the
 * gateway streams it from Sia instead, so a request for a large rendition
 * cannot grow the process by the size of the file.
 */

// a whole object up to this size is buffered and cached; the gateway streams
// anything larger. Manifests, playlists and thumbnails are far below it.
export const CACHEABLE_OBJECT_MAX_BYTES = 8 * 1024 * 1024;

const CACHE_MAX_SIZE = env.CACHE_MAX_SIZE_MB * 1024 * 1024;

const objectCache = new LRUCache<string, Uint8Array>({
  maxSize: CACHE_MAX_SIZE,
  maxEntrySize: Math.min(CACHEABLE_OBJECT_MAX_BYTES, CACHE_MAX_SIZE),
  sizeCalculation: (value) => Math.max(value.length, 1),
});

/** Master manifests read by /v1/stream, kept apart so object reads cannot evict them. */
const manifestCache = new LRUCache<string, Uint8Array>({
  max: 1000,
  maxSize: 32 * 1024 * 1024,
  maxEntrySize: CACHEABLE_OBJECT_MAX_BYTES,
  sizeCalculation: (value) => Math.max(value.length, 1),
});

/** Cumulative hit/miss counters (surfaced via /v1/cache/stats). */
let hits = 0;
let misses = 0;

export type CacheStatus = 'HIT' | 'MISS';

export type SmallObjectResult =
  | { kind: 'cached'; data: Uint8Array; status: CacheStatus }
  /** too large to buffer: stream it from the handle */
  | { kind: 'large'; handle: ObjectHandle };

type Opener = (objectId: string) => Promise<ObjectHandle>;

interface GetOptions {
  isManifest?: boolean;
  /** Injected opener (defaults to the Sia indexer); lets tests run without one. */
  open?: Opener;
}

// concurrent misses on one object share a single indexer lookup and download
const inflight = new Map<string, Promise<SmallObjectResult>>();

/**
 * A whole object from the cache, or fetched from Sia and cached when it is
 * small enough. A large object comes back as a handle to stream, uncached.
 */
export async function getSmallObject(
  objectId: string,
  opts: GetOptions = {},
): Promise<SmallObjectResult> {
  const isManifest = opts.isManifest ?? false;
  const cache = isManifest ? manifestCache : objectCache;

  const cached = cache.get(objectId);
  if (cached) {
    hits++;
    return { kind: 'cached', data: cached, status: 'HIT' };
  }

  const key = `${isManifest ? 'm' : 'o'}:${objectId}`;
  const pending = inflight.get(key);
  if (pending) {
    const shared = await pending;
    // a waiter was served from memory, not from Sia
    if (shared.kind === 'cached') {
      hits++;
      return { kind: 'cached', data: shared.data, status: 'HIT' };
    }
    return shared;
  }

  const fetching = (async (): Promise<SmallObjectResult> => {
    misses++;
    const handle = await (opts.open ?? openObject)(objectId);
    if (handle.size > CACHEABLE_OBJECT_MAX_BYTES) return { kind: 'large', handle };
    const data =
      handle.size === 0
        ? new Uint8Array(0)
        : await readExactly(handle.read({ offset: 0, length: handle.size }), handle.size);
    cache.set(objectId, data);
    return { kind: 'cached', data, status: 'MISS' };
  })();
  inflight.set(key, fetching);
  try {
    return await fetching;
  } finally {
    inflight.delete(key);
  }
}

/** A cached object's bytes without fetching, or undefined. */
export function peekCachedObject(objectId: string): Uint8Array | undefined {
  return objectCache.peek(objectId);
}

/**
 * Prefetch a set of objects into the cache (e.g. right after a transcode
 * finishes, so the first playback is already warm). Objects already cached
 * are skipped, and objects too large to cache are not downloaded. Individual
 * failures are swallowed: warming is best-effort and must never break the
 * caller. Returns how many were newly warmed.
 */
export async function warmObjects(objectIds: string[], opts: GetOptions = {}): Promise<number> {
  const cache = opts.isManifest ? manifestCache : objectCache;

  let warmed = 0;
  await Promise.all(
    objectIds.map(async (objectId) => {
      if (cache.has(objectId)) return;
      try {
        const result = await getSmallObject(objectId, opts);
        if (result.kind === 'cached') warmed++;
      } catch (err) {
        logger.warn({ objectId, err }, 'Cache warm failed for object');
      }
    }),
  );

  if (warmed > 0) {
    logger.info({ warmed, requested: objectIds.length }, 'Cache warmed');
  }
  return warmed;
}

/**
 * Evict objects from both caches, e.g. after an asset is deleted and its
 * objects are unpinned from Sia, so the memory is given back.
 * Returns how many cache entries were removed.
 */
export function evictObjects(objectIds: string[]): number {
  let removed = 0;
  for (const id of objectIds) {
    if (objectCache.delete(id)) removed++;
    if (manifestCache.delete(id)) removed++;
  }
  if (removed > 0) {
    logger.debug({ requested: objectIds.length, removed }, 'Evicted objects from cache');
  }
  return removed;
}

export function getCacheStats() {
  return {
    object: {
      size: objectCache.calculatedSize,
      maxSize: CACHE_MAX_SIZE,
      items: objectCache.size,
    },
    manifest: {
      items: manifestCache.size,
    },
    hits,
    misses,
  };
}
