import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

// Upload metrics
export const uploadSuccessTotal = new Counter({
  name: 'siastream_upload_success_total',
  help: 'Total number of successful uploads',
  registers: [registry],
});

export const uploadFailureTotal = new Counter({
  name: 'siastream_upload_failure_total',
  help: 'Total number of failed uploads',
  registers: [registry],
});

export const uploadBytesTotal = new Counter({
  name: 'siastream_upload_bytes_total',
  help: 'Total bytes uploaded',
  registers: [registry],
});

// Processing metrics
export const processingDurationSeconds = new Histogram({
  name: 'siastream_processing_duration_seconds',
  help: 'Time to transcode and upload video segments',
  buckets: [30, 60, 120, 300, 600, 1200, 1800, 3600],
  registers: [registry],
});

export const processingQueueDepth = new Gauge({
  name: 'siastream_processing_queue_depth',
  help: 'Number of jobs in the processing queue',
  registers: [registry],
});

// Playback metrics
export const playbackInitiationTotal = new Counter({
  name: 'siastream_playback_initiation_total',
  help: 'Total number of playback initiations',
  labelNames: ['video_asset_id'] as const,
  registers: [registry],
});

export const segmentRequestsTotal = new Counter({
  name: 'siastream_segment_requests_total',
  help: 'Total number of segment fetch requests',
  labelNames: ['quality'] as const,
  registers: [registry],
});

export const bandwidthBytesTotal = new Counter({
  name: 'siastream_bandwidth_bytes_total',
  help: 'Total bandwidth served in bytes',
  labelNames: ['video_asset_id'] as const,
  registers: [registry],
});

// Cache metrics
export const cacheHitRatio = new Gauge({
  name: 'siastream_cache_hit_ratio',
  help: 'Ratio of cache hits to total requests',
  registers: [registry],
});

// Sia storage metrics
export const siaUploadDurationSeconds = new Histogram({
  name: 'siastream_sia_upload_duration_seconds',
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
