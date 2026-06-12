import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { CacheManager } from '../delivery/cache-manager.js';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
  });

  describe('get / set for segments', () => {
    it('should return undefined for a cache miss', () => {
      const result = cache.get('nonexistent-key');
      expect(result).toBeUndefined();
    });

    it('should return the cached value for a cache hit', () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      cache.set('seg-1', data);

      const result = cache.get('seg-1');
      expect(result).toEqual(data);
    });

    it('should store and retrieve different keys independently', () => {
      const data1 = new Uint8Array([1, 2]);
      const data2 = new Uint8Array([3, 4]);
      cache.set('key-a', data1);
      cache.set('key-b', data2);

      expect(cache.get('key-a')).toEqual(data1);
      expect(cache.get('key-b')).toEqual(data2);
    });

    it('should overwrite existing entry with same key', () => {
      const oldData = new Uint8Array([1]);
      const newData = new Uint8Array([2]);
      cache.set('key', oldData);
      cache.set('key', newData);

      expect(cache.get('key')).toEqual(newData);
    });
  });

  describe('get / set for manifests', () => {
    it('should return undefined for a manifest cache miss', () => {
      const result = cache.get('manifest-key', true);
      expect(result).toBeUndefined();
    });

    it('should store and retrieve manifest data separately from segments', () => {
      const segData = new Uint8Array([1, 2, 3]);
      const manifestData = new Uint8Array([10, 20, 30]);

      // Same key, different caches
      cache.set('key-1', segData, false);
      cache.set('key-1', manifestData, true);

      expect(cache.get('key-1', false)).toEqual(segData);
      expect(cache.get('key-1', true)).toEqual(manifestData);
    });
  });

  describe('delete', () => {
    it('should remove entry from both segment and manifest caches', () => {
      cache.set('key-1', new Uint8Array([1]), false);
      cache.set('key-1', new Uint8Array([2]), true);

      cache.delete('key-1');

      expect(cache.get('key-1', false)).toBeUndefined();
      expect(cache.get('key-1', true)).toBeUndefined();
    });

    it('should not affect other keys', () => {
      cache.set('key-a', new Uint8Array([1]));
      cache.set('key-b', new Uint8Array([2]));

      cache.delete('key-a');

      expect(cache.get('key-a')).toBeUndefined();
      expect(cache.get('key-b')).toEqual(new Uint8Array([2]));
    });
  });

  describe('getStats', () => {
    it('should track hits and misses', () => {
      cache.set('existing', new Uint8Array([1]));

      cache.get('existing');      // hit
      cache.get('nonexistent');   // miss
      cache.get('existing');      // hit
      cache.get('also-missing');  // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRatio).toBeCloseTo(0.5);
    });

    it('should return 0 hit ratio when no requests made', () => {
      const stats = cache.getStats();
      expect(stats.hitRatio).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should report segment cache size', () => {
      cache.set('seg-1', new Uint8Array(100));
      cache.set('seg-2', new Uint8Array(200));

      const stats = cache.getStats();
      expect(stats.segmentCache.items).toBe(2);
      expect(stats.segmentCache.size).toBe(300);
    });

    it('should report manifest cache items', () => {
      cache.set('manifest-1', new Uint8Array([1]), true);
      cache.set('manifest-2', new Uint8Array([2]), true);

      const stats = cache.getStats();
      expect(stats.manifestCache.items).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all cached entries', () => {
      cache.set('seg-1', new Uint8Array([1]));
      cache.set('manifest-1', new Uint8Array([2]), true);

      cache.get('seg-1'); // Generate a hit

      cache.clear();

      expect(cache.get('seg-1')).toBeUndefined();
      expect(cache.get('manifest-1', true)).toBeUndefined();
    });

    it('should reset hit/miss counters', () => {
      cache.set('key', new Uint8Array([1]));
      cache.get('key');          // hit
      cache.get('missing');      // miss

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should accept custom configuration', () => {
      const customCache = new CacheManager({
        maxSizeBytes: 512,
        manifestTtlMs: 1000,
        segmentTtlMs: 5000,
      });

      // Should work normally
      customCache.set('key', new Uint8Array(100));
      expect(customCache.get('key')).toBeDefined();
    });

    it('should evict segments when maxSizeBytes is exceeded', () => {
      const smallCache = new CacheManager({
        maxSizeBytes: 100,
      });

      // Add entries that exceed the limit
      smallCache.set('a', new Uint8Array(60));
      smallCache.set('b', new Uint8Array(60));

      // At least one entry should have been evicted
      const stats = smallCache.getStats();
      expect(stats.segmentCache.size).toBeLessThanOrEqual(100);
    });
  });
});
