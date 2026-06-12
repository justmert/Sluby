import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchRaw } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthStatus {
  status: string;
  version: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHealthCheck(
  refetchInterval: number | false = false,
): UseQueryResult<HealthStatus> {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchRaw<HealthStatus>('/health'),
    refetchInterval,
    staleTime: 10_000,
    gcTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
}
