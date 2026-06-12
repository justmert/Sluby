import { useRef, useCallback } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types (match backend prom-client JSON format)
// ---------------------------------------------------------------------------

export interface PromMetricValue {
  value: number;
  labels: Record<string, string>;
}

export interface PromMetric {
  name: string;
  help: string;
  type: string;
  values: PromMetricValue[];
}

export interface PromMetricsResponse {
  timestamp: string;
  metrics: PromMetric[];
}

export interface ParsedMetrics {
  timestamp: string;
  uptime: number;
  totalAssets: number;
  totalUploads: number;
  activeStreams: number;
  storageBytes: number;
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
  requestsTotal: number;
  errorsTotal: number;
  avgResponseMs: number;
  bandwidthBytes: number;
  raw: Array<{ name: string; help: string; type: string; value: number }>;
}

export interface MetricsWithHistory {
  current: ParsedMetrics;
  history: {
    totalAssets: number[];
    totalUploads: number[];
    activeStreams: number[];
    storageBytes: number[];
    cacheHits: number[];
    cacheMisses: number[];
    requestsTotal: number[];
    errorsTotal: number[];
    avgResponseMs: number[];
    bandwidthBytes: number[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_HISTORY = 20;

function getMetricValue(metrics: PromMetric[], name: string): number {
  const metric = metrics.find((m) => m.name === name);
  return metric?.values?.[0]?.value ?? 0;
}

/** Sum all label-set values for a metric (e.g. bandwidth_bytes_total with per-asset labels). */
function sumMetricValues(metrics: PromMetric[], name: string): number {
  const metric = metrics.find((m) => m.name === name);
  if (!metric?.values?.length) return 0;
  return metric.values.reduce((sum, v) => sum + (v.value ?? 0), 0);
}

function parseMetrics(data: PromMetricsResponse): ParsedMetrics {
  const { timestamp, metrics } = data;

  // Derive uptime from process_start_time_seconds (seconds since epoch)
  const startTime = getMetricValue(metrics, 'process_start_time_seconds');
  const uptime = startTime > 0 ? Date.now() / 1000 - startTime : 0;

  // Cache hit ratio is a gauge 0-1; derive hit/miss counts from cache stats endpoint.
  // Here we expose the ratio itself so the UI can display it directly.
  const cacheHitRatio = getMetricValue(metrics, 'siastream_cache_hit_ratio');

  const uploadSuccess = sumMetricValues(metrics, 'siastream_upload_success_total');
  const uploadFailure = sumMetricValues(metrics, 'siastream_upload_failure_total');

  return {
    timestamp,
    uptime,
    totalAssets: uploadSuccess, // best available proxy from prom metrics
    totalUploads: uploadSuccess,
    activeStreams: sumMetricValues(metrics, 'siastream_playback_initiation_total'),
    storageBytes: sumMetricValues(metrics, 'siastream_upload_bytes_total'),
    cacheHits: cacheHitRatio * 100, // store as percentage for display convenience
    cacheMisses: (1 - cacheHitRatio) * 100,
    cacheSize: 0, // not available as prom metric; sourced from /v1/cache/stats instead
    requestsTotal: sumMetricValues(metrics, 'siastream_segment_requests_total'),
    errorsTotal: uploadFailure,
    avgResponseMs:
      getMetricValue(metrics, 'siastream_sia_upload_duration_seconds') * 1000 +
      getMetricValue(metrics, 'siastream_metadata_duration_seconds') * 1000,
    bandwidthBytes: sumMetricValues(metrics, 'siastream_bandwidth_bytes_total'),
    raw: metrics.map((m) => ({
      name: m.name,
      help: m.help,
      type: m.type,
      value: m.values?.[0]?.value ?? 0,
    })),
  };
}

function pushHistory(arr: number[], value: number): number[] {
  const next = [...arr, value];
  if (next.length > MAX_HISTORY) next.shift();
  return next;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMetrics(
  refetchInterval: number | false = false,
): UseQueryResult<MetricsWithHistory> {
  const historyRef = useRef<MetricsWithHistory['history']>({
    totalAssets: [],
    totalUploads: [],
    activeStreams: [],
    storageBytes: [],
    cacheHits: [],
    cacheMisses: [],
    requestsTotal: [],
    errorsTotal: [],
    avgResponseMs: [],
    bandwidthBytes: [],
  });

  const select = useCallback(
    (data: PromMetricsResponse): MetricsWithHistory => {
      const current = parseMetrics(data);
      const h = historyRef.current;

      historyRef.current = {
        totalAssets: pushHistory(h.totalAssets, current.totalAssets),
        totalUploads: pushHistory(h.totalUploads, current.totalUploads),
        activeStreams: pushHistory(h.activeStreams, current.activeStreams),
        storageBytes: pushHistory(h.storageBytes, current.storageBytes),
        cacheHits: pushHistory(h.cacheHits, current.cacheHits),
        cacheMisses: pushHistory(h.cacheMisses, current.cacheMisses),
        requestsTotal: pushHistory(h.requestsTotal, current.requestsTotal),
        errorsTotal: pushHistory(h.errorsTotal, current.errorsTotal),
        avgResponseMs: pushHistory(h.avgResponseMs, current.avgResponseMs),
        bandwidthBytes: pushHistory(h.bandwidthBytes, current.bandwidthBytes),
      };

      return { current, history: historyRef.current };
    },
    [],
  );

  return useQuery({
    queryKey: ['metrics'],
    queryFn: () =>
      apiClient.get<PromMetricsResponse>('/metrics?format=json'),
    refetchInterval,
    select,
    staleTime: 10_000,
    gcTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
}
