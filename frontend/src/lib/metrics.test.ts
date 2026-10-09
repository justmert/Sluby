import { describe, expect, it } from 'vitest';
import {
  formatSpan,
  ratePerSecond,
  snapshotFromResponse,
  summarizeMetrics,
  type PromMetric,
} from './metrics';

// shaped like prom-client's registry.getMetricsAsJSON()
const metrics: PromMetric[] = [
  { name: 'sluby_upload_success_total', type: 'counter', values: [{ value: 5, labels: {} }] },
  { name: 'sluby_upload_failure_total', type: 'counter', values: [{ value: 1, labels: {} }] },
  { name: 'sluby_upload_bytes_total', type: 'counter', values: [{ value: 2048, labels: {} }] },
  {
    name: 'sluby_processing_duration_seconds',
    type: 'histogram',
    values: [
      { value: 2, labels: { le: 30 }, metricName: 'sluby_processing_duration_seconds_bucket' },
      { value: 90, labels: {}, metricName: 'sluby_processing_duration_seconds_sum' },
      { value: 3, labels: {}, metricName: 'sluby_processing_duration_seconds_count' },
    ],
  },
  { name: 'sluby_processing_queue_depth', type: 'gauge', values: [{ value: 2, labels: {} }] },
  {
    name: 'sluby_segment_requests_total',
    type: 'counter',
    values: [
      { value: 40, labels: { kind: 'media' } },
      { value: 6, labels: { kind: 'manifest' } },
    ],
  },
  {
    name: 'sluby_bandwidth_bytes_total',
    type: 'counter',
    values: [{ value: 1_000_000, labels: {} }],
  },
  { name: 'sluby_cache_hits_total', type: 'counter', values: [{ value: 3, labels: {} }] },
  { name: 'sluby_cache_misses_total', type: 'counter', values: [{ value: 1, labels: {} }] },
  { name: 'sluby_redis_up', type: 'gauge', values: [{ value: 1, labels: {} }] },
  {
    name: 'sluby_playback_initiation_total',
    type: 'counter',
    values: [
      { value: 4, labels: { mode: 'sia' } },
      { value: 1, labels: { mode: 'signed' } },
    ],
  },
  {
    name: 'process_start_time_seconds',
    type: 'gauge',
    values: [{ value: 1_790_000_000, labels: {} }],
  },
];

describe('summarizeMetrics', () => {
  const s = summarizeMetrics(metrics, 1000);

  it('reads counters and gauges', () => {
    expect(s.uploads).toEqual({ succeeded: 5, failed: 1, bytes: 2048 });
    expect(s.delivery.requests).toEqual({ manifest: 6, media: 40, object: 0 });
    expect(s.playback).toEqual({ public: 0, signed: 1, sia: 4 });
    expect(s.delivery.cacheHitRatio).toBe(0.75);
    expect(s.process.startedAt).toBe(1_790_000_000_000);
  });

  it('averages histograms from sum and count, ignoring buckets', () => {
    expect(s.processing).toEqual({ queueDepth: 2, completed: 3, avgSeconds: 30 });
    expect(s.sia).toEqual({ uploads: 0, avgSeconds: null });
  });

  it('reports the queue depth unknown while Redis does not answer', () => {
    // the backend sets the depth to NaN, which json carries as null
    const down = metrics.map((m) =>
      m.name === 'sluby_redis_up'
        ? { ...m, values: [{ value: 0, labels: {} }] }
        : m.name === 'sluby_processing_queue_depth'
          ? { ...m, values: [{ value: null as unknown as number, labels: {} }] }
          : m,
    );
    expect(summarizeMetrics(down, 0).processing.queueDepth).toBeNull();
  });

  it('has no hit ratio before any cache lookup', () => {
    const none = metrics.filter((m) => !m.name.startsWith('sluby_cache_'));
    expect(summarizeMetrics(none, 0).delivery.cacheHitRatio).toBeNull();
  });
});

describe('ratePerSecond', () => {
  const at = (t: number, bytes: number) => ({
    ...summarizeMetrics(metrics, t),
    delivery: { ...summarizeMetrics(metrics, t).delivery, bytes },
  });

  it('divides the counter delta by elapsed seconds', () => {
    expect(ratePerSecond(at(0, 1000), at(10_000, 6000), (x) => x.delivery.bytes)).toBe(500);
  });

  it('has no rate across a backend restart or without a previous sample', () => {
    expect(ratePerSecond(at(0, 6000), at(10_000, 100), (x) => x.delivery.bytes)).toBeNull();
    expect(ratePerSecond(undefined, at(10_000, 100), (x) => x.delivery.bytes)).toBeNull();
  });
});

describe('snapshotFromResponse', () => {
  it('times the snapshot by the server, not by when the answer arrived', () => {
    const snap = snapshotFromResponse({ timestamp: '2026-10-07T12:00:10.000Z', metrics });
    expect(snap.takenAt).toBe(Date.parse('2026-10-07T12:00:10.000Z'));
  });

  it('measures a rate over the server interval', () => {
    const at = (t: string, bytes: number) =>
      snapshotFromResponse({
        timestamp: t,
        metrics: [
          {
            name: 'sluby_bandwidth_bytes_total',
            type: 'counter',
            values: [{ value: bytes, labels: {} }],
          },
        ],
      });
    const rate = ratePerSecond(
      at('2026-10-07T12:00:00.000Z', 0),
      at('2026-10-07T12:00:10.000Z', 5_000),
      (s) => s.delivery.bytes,
    );
    expect(rate).toBe(500);
  });

  it('refuses a response without a timestamp', () => {
    expect(() => snapshotFromResponse({ timestamp: '', metrics })).toThrow(/timestamp/);
  });
});

describe('formatSpan', () => {
  it('keeps long spans short and in words, never raw seconds or a clock', () => {
    expect(formatSpan(4.24)).toBe('4.2 s');
    expect(formatSpan(42.4)).toBe('42 s');
    expect(formatSpan(539)).toBe('8 min');
    expect(formatSpan(3561)).toBe('59 min');
    expect(formatSpan(3600)).toBe('1 h');
    expect(formatSpan(2 * 3600 + 5 * 60)).toBe('2 h 5 min');
    expect(formatSpan(412 * 3600 + 3 * 60)).toBe('17 d 4 h');
    expect(formatSpan(-1)).toBe('–');
  });
});
