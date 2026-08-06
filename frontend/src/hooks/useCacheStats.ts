import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchRaw } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  entries: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCacheStats(refetchInterval: number | false = false): UseQueryResult<CacheStats> {
  return useQuery({
    queryKey: ['cache-stats'],
    queryFn: () => fetchRaw<CacheStats>('/v1/cache/stats'),
    refetchInterval,
    staleTime: 10_000,
    gcTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
}
