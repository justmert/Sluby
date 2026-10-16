// reads the backend's prometheus registry (GET /api/v1/metrics, as json) into
// the handful of numbers the analytics page shows

export interface PromValue {
  value: number;
  labels: Record<string, string | number>;
  metricName?: string;
}

export interface PromMetric {
  name: string;
  type: string;
  values: PromValue[];
}

/** GET /api/v1/metrics: the registry and when the server read it. */
export interface MetricsResponse {
  timestamp: string;
  metrics: PromMetric[];
}

export interface MetricsSnapshot {
  /** The server's clock when it read the registry, in ms. */
  takenAt: number;
  uploads: { succeeded: number; failed: number; bytes: number };
  /** queueDepth is null while the backend cannot read it from Redis. */
  processing: { queueDepth: number | null; completed: number; avgSeconds: number | null };
  sia: { uploads: number; avgSeconds: number | null };
  delivery: {
    requests: Record<'manifest' | 'media' | 'object', number>;
    bytes: number;
    /** Share of whole-object cache lookups served from memory; null before any. */
    cacheHitRatio: number | null;
  };
  playback: Record<'public' | 'signed' | 'sia', number>;
  process: { startedAt: number | null; residentBytes: number | null; heapUsedBytes: number | null };
}

function find(metrics: PromMetric[], name: string): PromMetric | undefined {
  return metrics.find((m) => m.name === name);
}

function sum(metric: PromMetric | undefined, labels: Record<string, string> = {}): number {
  if (!metric) return 0;
  return metric.values
    .filter((v) => Object.entries(labels).every(([k, l]) => String(v.labels[k]) === l))
    .reduce((n, v) => n + v.value, 0);
}

/** A gauge's value, null when the backend reported it unknown (NaN reaches json as null). */
function gaugeValue(metric: PromMetric | undefined): number | null {
  const v = metric?.values[0]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Histogram average from its _sum and _count samples; null before any observation. */
function histogramAvg(metric: PromMetric | undefined): { count: number; avg: number | null } {
  if (!metric) return { count: 0, avg: null };
  const total = metric.values.find((v) => v.metricName?.endsWith('_sum'))?.value ?? 0;
  const count = metric.values.find((v) => v.metricName?.endsWith('_count'))?.value ?? 0;
  return { count, avg: count > 0 ? total / count : null };
}

export function summarizeMetrics(metrics: PromMetric[], takenAt: number): MetricsSnapshot {
  const requests = find(metrics, 'sluby_segment_requests_total');
  const playback = find(metrics, 'sluby_playback_initiation_total');
  const processing = histogramAvg(find(metrics, 'sluby_processing_duration_seconds'));
  const sia = histogramAvg(find(metrics, 'sluby_sia_upload_duration_seconds'));
  const start = find(metrics, 'process_start_time_seconds')?.values[0]?.value;
  const hits = sum(find(metrics, 'sluby_cache_hits_total'));
  const misses = sum(find(metrics, 'sluby_cache_misses_total'));
  const redisUp = gaugeValue(find(metrics, 'sluby_redis_up'));

  return {
    takenAt,
    uploads: {
      succeeded: sum(find(metrics, 'sluby_upload_success_total')),
      failed: sum(find(metrics, 'sluby_upload_failure_total')),
      bytes: sum(find(metrics, 'sluby_upload_bytes_total')),
    },
    processing: {
      queueDepth: redisUp === 0 ? null : gaugeValue(find(metrics, 'sluby_processing_queue_depth')),
      completed: processing.count,
      avgSeconds: processing.avg,
    },
    sia: { uploads: sia.count, avgSeconds: sia.avg },
    delivery: {
      requests: {
        manifest: sum(requests, { kind: 'manifest' }),
        media: sum(requests, { kind: 'media' }),
        object: sum(requests, { kind: 'object' }),
      },
      bytes: sum(find(metrics, 'sluby_bandwidth_bytes_total')),
      cacheHitRatio: hits + misses > 0 ? hits / (hits + misses) : null,
    },
    playback: {
      public: sum(playback, { mode: 'public' }),
      signed: sum(playback, { mode: 'signed' }),
      sia: sum(playback, { mode: 'sia' }),
    },
    process: {
      startedAt: start ? start * 1000 : null,
      residentBytes: find(metrics, 'process_resident_memory_bytes')?.values[0]?.value ?? null,
      heapUsedBytes: find(metrics, 'nodejs_heap_size_used_bytes')?.values[0]?.value ?? null,
    },
  };
}

/** Per-second rate between two snapshots; null until there are two. */
export function ratePerSecond(
  prev: MetricsSnapshot | undefined,
  next: MetricsSnapshot,
  pick: (s: MetricsSnapshot) => number,
): number | null {
  if (!prev || next.takenAt <= prev.takenAt) return null;
  // a counter only drops when the backend restarted; there is no rate across that
  const delta = pick(next) - pick(prev);
  if (delta < 0) return null;
  return delta / ((next.takenAt - prev.takenAt) / 1000);
}

/**
 * Summarize a metrics response, timed by the server's own timestamp: the
 * browser's clock when the answer arrived would add network latency and
 * background-tab throttling to every rate.
 */
export function snapshotFromResponse(body: MetricsResponse): MetricsSnapshot {
  const takenAt = Date.parse(body.timestamp);
  if (!Number.isFinite(takenAt)) throw new Error('The metrics response has no valid timestamp');
  return summarizeMetrics(body.metrics, takenAt);
}

/**
 * A span of seconds short enough for a stat figure: "4.2 s", "42 s",
 * "9 min", "2 h 5 min", "3 d 4 h". Averages and uptime read the same way, so
 * an hour never shows as "3561 s" or as a clock (FLW-39).
 */
export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  if (seconds < 10) return `${Number(seconds.toFixed(1))} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
