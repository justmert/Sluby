import { downloadObject } from './sia-client.js';
import { LRUCache } from 'lru-cache';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

// Bound the object cache to the validated config value, so this stays a
// single source of truth with env.ts and .env.example (default 10240 MB)
// instead of re-reading process.env with a second, divergent default.
const CACHE_MAX_SIZE = env.CACHE_MAX_SIZE_MB * 1024 * 1024;

/** In-memory LRU cache for hot objects */
const objectCache = new LRUCache<string, Uint8Array>({
  maxSize: CACHE_MAX_SIZE,
  sizeCalculation: (value) => value.length,
  ttl: 24 * 60 * 60 * 1000, // 24 hours for segments
});

/** Short-TTL cache for manifests */
const manifestCache = new LRUCache<string, Uint8Array>({
  max: 1000,
  ttl: 60 * 1000, // 60 seconds for manifests
});

/** Cumulative hit/miss counters (surfaced via /v1/cache/stats). */
let hits = 0;
let misses = 0;

export type CacheStatus = 'HIT' | 'MISS';

export interface CachedResult {
  data: Uint8Array;
  status: CacheStatus;
}

type Fetcher = (objectId: string) => Promise<Uint8Array>;

interface GetOptions {
  isManifest?: boolean;
  /** Injected fetcher (defaults to Sia download); used to make caching
   *  logic testable without a live indexer. */
  fetch?: Fetcher;
}

/**
 * Fetch an object through the LRU cache, reporting whether the read was a
 * cache HIT or a MISS so the gateway can set an `X-Cache-Status` header.
 */
export async function getCachedObject(
  objectId: string,
  opts: GetOptions = {},
): Promise<CachedResult> {
  const isManifest = opts.isManifest ?? false;
  const fetchFn = opts.fetch ?? ((id: string) => downloadObject(id));
  const cache = isManifest ? manifestCache : objectCache;

  const cached = cache.get(objectId);
  if (cached) {
    hits++;
    logger.debug({ objectId, isManifest }, 'Cache hit');
    return { data: cached, status: 'HIT' };
  }

  misses++;
  logger.debug({ objectId, isManifest }, 'Cache miss, fetching from Sia');
  const data = await fetchFn(objectId);
  cache.set(objectId, data);
  return { data, status: 'MISS' };
}

/**
 * Prefetch a set of objects into the cache (e.g. right after a transcode
 * finishes, so the first playback is already warm). Objects already cached
 * are skipped. Individual failures are swallowed — warming is best-effort
 * and must never break the caller. Returns how many were newly warmed.
 */
export async function warmObjects(
  objectIds: string[],
  opts: GetOptions = {},
): Promise<number> {
  const isManifest = opts.isManifest ?? false;
  const fetchFn = opts.fetch ?? ((id: string) => downloadObject(id));
  const cache = isManifest ? manifestCache : objectCache;

  let warmed = 0;
  await Promise.all(
    objectIds.map(async (objectId) => {
      if (cache.has(objectId)) return;
      try {
        const data = await fetchFn(objectId);
        cache.set(objectId, data);
        warmed++;
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

export function invalidateObject(objectId: string): void {
  objectCache.delete(objectId);
  manifestCache.delete(objectId);
}
