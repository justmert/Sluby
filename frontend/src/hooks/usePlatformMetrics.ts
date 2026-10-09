import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { failedForGood } from './asset-queries';
import {
  ratePerSecond,
  snapshotFromResponse,
  type MetricsResponse,
  type MetricsSnapshot,
} from '@/lib/metrics';

const POLL_MS = 10_000;
// a rate needs two samples and a line two rates, so the first few come
// quickly and the throughput chart shows within seconds instead of 20 s
const SEED_MS = 2_000;
const SEED_SAMPLES = 3;
const KEEP = 60; // ten minutes of samples
const KEY = ['metrics'];

/** How long to wait after `failures` failed reads in a row: 2, 4, 8, then 16 s. */
export function backoffMs(failures: number): number {
  return SEED_MS * 2 ** Math.min(Math.max(failures - 1, 0), 3);
}

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
 *
 * While reads keep failing it backs off to 16 s, and the last error stays in
 * `error` during the next attempt: react query resets a query without data to
 * pending on every refetch, which made the page swap between the error and
 * skeletons (FLW-19).
 */
export function usePlatformMetrics(enabled: boolean) {
  const qc = useQueryClient();
  // failed reads in a row; the query's own counters reset on every fetch
  const failures = useRef(0);
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<MetricsHistory> => {
      try {
        const snap = snapshotFromResponse(await apiClient.get<MetricsResponse>('/metrics'));
        failures.current = 0;
        const prev = qc.getQueryData<MetricsHistory>(KEY)?.samples ?? [];
        const samples =
          prev.at(-1)?.takenAt === snap.takenAt ? prev : [...prev, snap].slice(-KEEP);
        return { latest: snap, samples };
      } catch (err) {
        failures.current += 1;
        throw err;
      }
    },
    enabled,
    refetchInterval: (query) => {
      // a 403 (not an operator) or other client error stays that way
      if (failedForGood(query)) return false;
      if (query.state.status === 'error') return backoffMs(failures.current);
      return (query.state.data?.samples.length ?? 0) < SEED_SAMPLES ? SEED_MS : POLL_MS;
    },
  });

  // the error on screen survives the refetch that would blank it
  const [lastError, setLastError] = useState<Error | null>(null);
  const error = query.error ?? (query.isSuccess || !query.isFetching ? null : lastError);
  if (error !== lastError) setLastError(error);

  return {
    ...query,
    error,
    isError: error !== null,
    snapshot: query.data?.latest,
    rates: toRates(query.data?.samples ?? []),
  };
}
