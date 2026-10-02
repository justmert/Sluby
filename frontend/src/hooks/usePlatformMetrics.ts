import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  ratePerSecond,
  summarizeMetrics,
  type MetricsSnapshot,
  type PromMetric,
} from '@/lib/metrics';

const POLL_MS = 10_000;
const KEEP = 60; // ten minutes of samples

export interface RatePoint {
  at: number;
  bytesPerSecond: number;
  requestsPerSecond: number;
}

/**
 * Polls the metrics registry and keeps the samples taken while the page is
 * open, so delivery rates can be drawn. Nothing is stored server side, so the
 * series starts empty on every visit.
 */
export function usePlatformMetrics() {
  const query = useQuery({
    queryKey: ['metrics'],
    queryFn: async () => {
      const body = await apiClient.get<{ metrics: PromMetric[] }>('/metrics');
      return summarizeMetrics(body.metrics);
    },
    refetchInterval: POLL_MS,
  });
  const [samples, setSamples] = useState<MetricsSnapshot[]>([]);

  useEffect(() => {
    const snap = query.data;
    if (!snap) return;
    setSamples((prev) =>
      prev.at(-1)?.takenAt === snap.takenAt ? prev : [...prev, snap].slice(-KEEP),
    );
  }, [query.data]);

  const rates: RatePoint[] = samples.slice(1).flatMap((s, i) => {
    const bytes = ratePerSecond(samples[i], s, (x) => x.delivery.bytes);
    const reqs = ratePerSecond(samples[i], s, (x) =>
      Object.values(x.delivery.requests).reduce((a, b) => a + b, 0),
    );
    return bytes === null || reqs === null
      ? []
      : [{ at: s.takenAt, bytesPerSecond: bytes, requestsPerSecond: reqs }];
  });

  return { ...query, rates };
}
