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

/**
 * How long a scrape waits for the queue depth. ioredis holds commands while
 * it is disconnected instead of failing them, so without a bound a scrape
 * during a Redis outage never answers, process metrics included.
 */
export const QUEUE_DEPTH_TIMEOUT_MS = 2000;

let depthRead: Promise<number | null> | null = null;

/** The queue depth, or null when Redis did not answer in time or failed. */
function readQueueDepth(): Promise<number | null> {
  const source = queueDepthSource;
  if (!source) return Promise.resolve(null);
  // the depth and redis_up gauges are collected in the same scrape; one read
  // serves both
  depthRead ??= new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), QUEUE_DEPTH_TIMEOUT_MS);
    // through then() so a source that throws synchronously counts as failed too
    Promise.resolve()
      .then(source)
      .then(
        (depth) => {
          clearTimeout(timer);
          resolve(depth);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
  }).finally(() => {
    depthRead = null;
  });
  return depthRead;
}

export const processingQueueDepth = new Gauge({
  name: 'sluby_processing_queue_depth',
  help: 'Jobs waiting or running across the transcode, upload and finalize queues (NaN while Redis does not answer)',
  registers: [registry],
  async collect() {
    if (!queueDepthSource) return;
    const depth = await readQueueDepth();
    // NaN rather than a stale or zero depth: the value is unknown
    this.set(depth ?? NaN);
  },
});

export const redisUp = new Gauge({
  name: 'sluby_redis_up',
  help: 'Whether Redis answered the queue depth read of this scrape within the timeout (1) or not (0)',
  registers: [registry],
  async collect() {
    if (!queueDepthSource) return;
    this.set((await readQueueDepth()) === null ? 0 : 1);
  },
});

// Playback metrics
// no per-asset labels: one series per asset would grow without bound
export const playbackInitiationTotal = new Counter({
  name: 'sluby_playback_initiation_total',
  help: 'Playback urls handed out (public, private unsigned, signed and sia share maps)',
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
// counters rather than a ratio, so a dashboard can take the hit rate over any
// window. they count lookups in the whole-object cache (manifests, thumbnails
// and other reads without a Range header); ranged media reads go to Sia
// without it and show up only in sluby_segment_requests_total.
export const cacheHitsTotal = new Counter({
  name: 'sluby_cache_hits_total',
  help: 'Gateway whole-object cache lookups served from memory',
  registers: [registry],
  collect() {
    if (!cacheCountsSource) return;
    this.reset();
    this.inc(cacheCountsSource().hits);
  },
});

export const cacheMissesTotal = new Counter({
  name: 'sluby_cache_misses_total',
  help: 'Gateway whole-object cache lookups that fetched the object from Sia',
  registers: [registry],
  collect() {
    if (!cacheCountsSource) return;
    this.reset();
    this.inc(cacheCountsSource().misses);
  },
});

// Sia storage metrics
// a packed upload of a long video takes minutes, so the buckets reach 30 min
export const siaUploadDurationSeconds = new Histogram({
  name: 'sluby_sia_upload_duration_seconds',
  help: 'Time to upload an object to Sia',
  buckets: [1, 5, 15, 30, 60, 120, 300, 600, 900, 1200, 1800],
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
