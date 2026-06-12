import { downloadObject } from './sia-client.js';
import { LRUCache } from 'lru-cache';
import { logger } from '../config/logger.js';

const CACHE_MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE_MB ?? '1024', 10) * 1024 * 1024;

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

export async function getCachedObject(
  objectId: string,
  isManifest = false,
): Promise<Uint8Array> {
  const cache = isManifest ? manifestCache : objectCache;

  const cached = cache.get(objectId);
  if (cached) {
    logger.debug({ objectId, isManifest }, 'Cache hit');
    return cached;
  }

  logger.debug({ objectId, isManifest }, 'Cache miss, fetching from Sia');
  const data = await downloadObject(objectId);

  cache.set(objectId, data);
  return data;
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
  };
}

export function invalidateObject(objectId: string): void {
  objectCache.delete(objectId);
  manifestCache.delete(objectId);
}
