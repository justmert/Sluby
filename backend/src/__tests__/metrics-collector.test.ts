import { describe, it, expect } from 'vitest';
import {
  registry,
  recordDelivery,
  setMetricSources,
  playbackInitiationTotal,
} from '../metrics/collector.js';

async function value(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name);
  const point = (metric?.values ?? []).find((v) =>
    Object.entries(labels).every(([k, l]) => (v.labels as Record<string, string>)[k] === l),
  );
  return point?.value ?? 0;
}

describe('metrics collector', () => {
  it('counts gateway responses by kind and their bytes', async () => {
    const before = await value('sluby_bandwidth_bytes_total');
    const media = await value('sluby_segment_requests_total', { kind: 'media' });
    recordDelivery('media', 1000);
    recordDelivery('manifest', 24);
    expect(await value('sluby_bandwidth_bytes_total')).toBe(before + 1024);
    expect(await value('sluby_segment_requests_total', { kind: 'media' })).toBe(media + 1);
  });

  it('computes the cache hit ratio and queue depth from live sources at scrape time', async () => {
    let depth = 3;
    setMetricSources({
      queueDepth: async () => depth,
      cacheCounts: () => ({ hits: 3, misses: 1 }),
    });
    expect(await value('sluby_cache_hit_ratio')).toBe(0.75);
    expect(await value('sluby_processing_queue_depth')).toBe(3);
    depth = 0;
    expect(await value('sluby_processing_queue_depth')).toBe(0);
  });

  it('labels playback issuance by mode, not by asset', async () => {
    playbackInitiationTotal.inc({ mode: 'sia' });
    const metric = (await registry.getMetricsAsJSON()).find(
      (m) => m.name === 'sluby_playback_initiation_total',
    );
    expect(metric?.values.every((v) => Object.keys(v.labels).join() === 'mode')).toBe(true);
  });
});
