import { LRUCache } from 'lru-cache';
import { logger } from '../config/logger.js';

export interface CacheConfig {
  maxSizeBytes: number;
  manifestTtlMs: number;
  segmentTtlMs: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxSizeBytes: 1024 * 1024 * 1024, // 1 GB
  manifestTtlMs: 60 * 1000,          // 60 seconds
  segmentTtlMs: 24 * 60 * 60 * 1000, // 24 hours
};

export class CacheManager {
  private segmentCache: LRUCache<string, Uint8Array>;
  private manifestCache: LRUCache<string, Uint8Array>;
  private hits = 0;
  private misses = 0;

  constructor(config: Partial<CacheConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    this.segmentCache = new LRUCache<string, Uint8Array>({
      maxSize: cfg.maxSizeBytes,
      sizeCalculation: (value) => value.length,
      ttl: cfg.segmentTtlMs,
    });

    this.manifestCache = new LRUCache<string, Uint8Array>({
      max: 10000,
      ttl: cfg.manifestTtlMs,
    });
  }

  get(key: string, isManifest = false): Uint8Array | undefined {
    const cache = isManifest ? this.manifestCache : this.segmentCache;
    const value = cache.get(key);

    if (value) {
      this.hits++;
    } else {
      this.misses++;
    }

    return value;
  }

  set(key: string, value: Uint8Array, isManifest = false): void {
    const cache = isManifest ? this.manifestCache : this.segmentCache;
    cache.set(key, value);
  }

  delete(key: string): void {
    this.segmentCache.delete(key);
    this.manifestCache.delete(key);
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRatio: total > 0 ? this.hits / total : 0,
      segmentCache: {
        size: this.segmentCache.calculatedSize,
        items: this.segmentCache.size,
      },
      manifestCache: {
        items: this.manifestCache.size,
      },
    };
  }

  clear(): void {
    this.segmentCache.clear();
    this.manifestCache.clear();
    this.hits = 0;
    this.misses = 0;
    logger.info('Cache cleared');
  }
}

export const globalCache = new CacheManager();
