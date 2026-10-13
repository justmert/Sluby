import { describe, expect, it } from 'vitest';
import { ratePerSecond, summarizeMetrics, type PromMetric } from './metrics';

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
  { name: 'sluby_cache_hit_ratio', type: 'gauge', values: [{ value: 0.5, labels: {} }] },
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
    expect(s.delivery.cacheHitRatio).toBe(0.5);
    expect(s.process.startedAt).toBe(1_790_000_000_000);
  });

  it('averages histograms from sum and count, ignoring buckets', () => {
    expect(s.processing).toEqual({ queueDepth: 2, completed: 3, avgSeconds: 30 });
    expect(s.sia).toEqual({ uploads: 0, avgSeconds: null });
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
