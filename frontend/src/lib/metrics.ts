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

export interface MetricsSnapshot {
  takenAt: number;
  uploads: { succeeded: number; failed: number; bytes: number };
  processing: { queueDepth: number; completed: number; avgSeconds: number | null };
  sia: { uploads: number; avgSeconds: number | null };
  delivery: {
    requests: Record<'manifest' | 'media' | 'object', number>;
    bytes: number;
    cacheHitRatio: number;
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

/** Histogram average from its _sum and _count samples; null before any observation. */
function histogramAvg(metric: PromMetric | undefined): { count: number; avg: number | null } {
  if (!metric) return { count: 0, avg: null };
  const total = metric.values.find((v) => v.metricName?.endsWith('_sum'))?.value ?? 0;
  const count = metric.values.find((v) => v.metricName?.endsWith('_count'))?.value ?? 0;
  return { count, avg: count > 0 ? total / count : null };
}

export function summarizeMetrics(metrics: PromMetric[], takenAt = Date.now()): MetricsSnapshot {
  const requests = find(metrics, 'sluby_segment_requests_total');
  const playback = find(metrics, 'sluby_playback_initiation_total');
  const processing = histogramAvg(find(metrics, 'sluby_processing_duration_seconds'));
  const sia = histogramAvg(find(metrics, 'sluby_sia_upload_duration_seconds'));
  const start = find(metrics, 'process_start_time_seconds')?.values[0]?.value;

  return {
    takenAt,
    uploads: {
      succeeded: sum(find(metrics, 'sluby_upload_success_total')),
      failed: sum(find(metrics, 'sluby_upload_failure_total')),
      bytes: sum(find(metrics, 'sluby_upload_bytes_total')),
    },
    processing: {
      queueDepth: sum(find(metrics, 'sluby_processing_queue_depth')),
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
      cacheHitRatio: sum(find(metrics, 'sluby_cache_hit_ratio')),
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
