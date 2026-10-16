import { describe, it, expect, afterEach } from 'vitest';
import {
  registry,
  recordDelivery,
  setMetricSources,
  playbackInitiationTotal,
  QUEUE_DEPTH_TIMEOUT_MS,
} from '../metrics/collector.js';

async function value(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name);
  const point = (metric?.values ?? []).find((v) =>
    Object.entries(labels).every(([k, l]) => (v.labels as Record<string, string>)[k] === l),
  );
  return point?.value ?? 0;
}

afterEach(() => {
  setMetricSources({ queueDepth: async () => 0, cacheCounts: () => ({ hits: 0, misses: 0 }) });
});

describe('metrics collector', () => {
  it('counts gateway responses by kind and their bytes', async () => {
    const before = await value('sluby_bandwidth_bytes_total');
    const media = await value('sluby_segment_requests_total', { kind: 'media' });
    recordDelivery('media', 1000);
    recordDelivery('manifest', 24);
    expect(await value('sluby_bandwidth_bytes_total')).toBe(before + 1024);
    expect(await value('sluby_segment_requests_total', { kind: 'media' })).toBe(media + 1);
  });

  it('reads cache hits and misses and the queue depth from live sources at scrape time', async () => {
    let depth = 3;
    setMetricSources({
      queueDepth: async () => depth,
      cacheCounts: () => ({ hits: 3, misses: 1 }),
    });
    expect(await value('sluby_cache_hits_total')).toBe(3);
    expect(await value('sluby_cache_misses_total')).toBe(1);
    expect(await value('sluby_processing_queue_depth')).toBe(3);
    expect(await value('sluby_redis_up')).toBe(1);
    depth = 0;
    expect(await value('sluby_processing_queue_depth')).toBe(0);
  });

  it('exposes cache counters, not a since-start ratio', async () => {
    const names = (await registry.getMetricsAsJSON()).map((m) => m.name);
    expect(names).not.toContain('sluby_cache_hit_ratio');
    const text = await registry.metrics();
    expect(text).toContain('# TYPE sluby_cache_hits_total counter');
    expect(text).toContain('# TYPE sluby_cache_misses_total counter');
  });

  it('labels playback issuance by mode, not by asset', async () => {
    playbackInitiationTotal.inc({ mode: 'sia' });
    const metric = (await registry.getMetricsAsJSON()).find(
      (m) => m.name === 'sluby_playback_initiation_total',
    );
    expect(metric?.values.every((v) => Object.keys(v.labels).join() === 'mode')).toBe(true);
  });

  it('has sia upload buckets up to 30 minutes, since packed uploads take minutes', async () => {
    const metric = (await registry.getMetricsAsJSON()).find(
      (m) => m.name === 'sluby_sia_upload_duration_seconds',
    );
    const bounds = (metric?.values ?? [])
      .map((v) => (v.labels as Record<string, string | number>).le)
      .filter((le) => le !== undefined && le !== '+Inf')
      .map(Number);
    expect(Math.max(...bounds)).toBe(1800);
    expect(bounds).toEqual(expect.arrayContaining([120, 300, 600]));
  });

  describe('while the queue depth cannot be read', () => {
    it('answers the scrape in time, with the depth unknown and redis_up 0', async () => {
      setMetricSources({
        queueDepth: () => new Promise<number>(() => {}),
        cacheCounts: () => ({ hits: 0, misses: 0 }),
      });
      const started = Date.now();
      const text = await registry.metrics();
      expect(Date.now() - started).toBeLessThan(QUEUE_DEPTH_TIMEOUT_MS + 2000);
      expect(text).toMatch(/^sluby_processing_queue_depth Nan$/m);
      expect(text).toMatch(/^sluby_redis_up 0$/m);
      expect(text).toContain('process_cpu_user_seconds_total');
    });

    it('treats a failed read like an unanswered one', async () => {
      setMetricSources({
        queueDepth: async () => {
          throw new Error('redis is down');
        },
        cacheCounts: () => ({ hits: 0, misses: 0 }),
      });
      const text = await registry.metrics();
      expect(text).toMatch(/^sluby_processing_queue_depth Nan$/m);
      expect(text).toMatch(/^sluby_redis_up 0$/m);
    });
  });
});
