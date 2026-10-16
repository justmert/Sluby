import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  ratePerSecond,
  snapshotFromResponse,
  type MetricsResponse,
  type MetricsSnapshot,
} from '@/lib/metrics';

const POLL_MS = 10_000;
const KEEP = 60; // ten minutes of samples
const KEY = ['metrics'];

export interface RatePoint {
  at: number;
  bytesPerSecond: number;
  requestsPerSecond: number;
}

interface MetricsHistory {
  latest: MetricsSnapshot;
  samples: MetricsSnapshot[];
}

function toRates(samples: MetricsSnapshot[]): RatePoint[] {
  return samples.slice(1).flatMap((s, i) => {
    const bytes = ratePerSecond(samples[i], s, (x) => x.delivery.bytes);
    const reqs = ratePerSecond(samples[i], s, (x) =>
      Object.values(x.delivery.requests).reduce((a, b) => a + b, 0),
    );
    return bytes === null || reqs === null
      ? []
      : [{ at: s.takenAt, bytesPerSecond: bytes, requestsPerSecond: reqs }];
  });
}

/**
 * Polls the metrics registry (operators only; anyone else gets 403) and keeps
 * the samples taken while it is watched, so delivery rates can be drawn.
 * Nothing is stored server side, so the series starts empty once the query
 * cache drops it.
 */
export function usePlatformMetrics(enabled: boolean) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<MetricsHistory> => {
      const snap = snapshotFromResponse(await apiClient.get<MetricsResponse>('/metrics'));
      const prev = qc.getQueryData<MetricsHistory>(KEY)?.samples ?? [];
      const samples = prev.at(-1)?.takenAt === snap.takenAt ? prev : [...prev, snap].slice(-KEEP);
      return { latest: snap, samples };
    },
    enabled,
    refetchInterval: POLL_MS,
  });
  return { ...query, snapshot: query.data?.latest, rates: toRates(query.data?.samples ?? []) };
}
