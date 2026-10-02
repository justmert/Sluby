import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

// Upload metrics
export const uploadSuccessTotal = new Counter({
  name: 'sluby_upload_success_total',
  help: 'Total number of successful uploads',
  registers: [registry],
});

export const uploadFailureTotal = new Counter({
  name: 'sluby_upload_failure_total',
  help: 'Total number of failed uploads',
  registers: [registry],
});

export const uploadBytesTotal = new Counter({
  name: 'sluby_upload_bytes_total',
  help: 'Total bytes uploaded',
  registers: [registry],
});

// Processing metrics
export const processingDurationSeconds = new Histogram({
  name: 'sluby_processing_duration_seconds',
  help: 'Time to transcode and upload video segments',
  buckets: [30, 60, 120, 300, 600, 1200, 1800, 3600],
  registers: [registry],
});

// sources are registered at startup (setMetricSources) so this module does
// not import the queue or cache layers
let queueDepthSource: (() => Promise<number>) | null = null;
let cacheCountsSource: (() => { hits: number; misses: number }) | null = null;

export function setMetricSources(sources: {
  queueDepth: () => Promise<number>;
  cacheCounts: () => { hits: number; misses: number };
}): void {
  queueDepthSource = sources.queueDepth;
  cacheCountsSource = sources.cacheCounts;
}

export const processingQueueDepth = new Gauge({
  name: 'sluby_processing_queue_depth',
  help: 'Jobs waiting or running across the transcode, upload and finalize queues',
  registers: [registry],
  async collect() {
    if (queueDepthSource) this.set(await queueDepthSource());
  },
});

// Playback metrics
// no per-asset labels: one series per asset would grow without bound
export const playbackInitiationTotal = new Counter({
  name: 'sluby_playback_initiation_total',
  help: 'Playback urls handed out (public, signed and sia share maps)',
  labelNames: ['mode'] as const,
  registers: [registry],
});

export const segmentRequestsTotal = new Counter({
  name: 'sluby_segment_requests_total',
  help: 'Objects served by the delivery gateway',
  labelNames: ['kind'] as const,
  registers: [registry],
});

export const bandwidthBytesTotal = new Counter({
  name: 'sluby_bandwidth_bytes_total',
  help: 'Bytes served by the delivery gateway',
  registers: [registry],
});

/** Count one gateway response and its body size. */
export function recordDelivery(kind: 'manifest' | 'media' | 'object', bytes: number): void {
  segmentRequestsTotal.inc({ kind });
  bandwidthBytesTotal.inc(bytes);
}

// Cache metrics
export const cacheHitRatio = new Gauge({
  name: 'sluby_cache_hit_ratio',
  help: 'Gateway cache hits over all cache lookups since start (0 before any lookup)',
  registers: [registry],
  collect() {
    if (!cacheCountsSource) return;
    const { hits, misses } = cacheCountsSource();
    this.set(hits + misses > 0 ? hits / (hits + misses) : 0);
  },
});

// Sia storage metrics
export const siaUploadDurationSeconds = new Histogram({
  name: 'sluby_sia_upload_duration_seconds',
  help: 'Time to upload an object to Sia',
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

/**
 * Get metrics in Prometheus text format.
 */
export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

/**
 * Get metrics as a JSON summary.
 */
export async function getMetricsJson(): Promise<Record<string, unknown>> {
  const metrics = await registry.getMetricsAsJSON();
  return {
    timestamp: new Date().toISOString(),
    metrics,
  };
}
