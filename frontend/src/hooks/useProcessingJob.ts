import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessingLog {
  timestamp: string;
  stage: string; // 'transcode' | 'upload' | 'finalize'
  message: string;
}

export interface ProcessingJob {
  id: string;
  status: string;
  progress_percent: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  logs: ProcessingLog[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Poll processing job progress for an asset.
 *
 * @param assetId  - The video asset ID to track.
 * @param enabled  - Whether polling is active (default true).
 * @returns Query result with the processing job or null (404 = no job).
 */
export function useProcessingJob(
  assetId?: string,
  enabled: boolean = true,
): UseQueryResult<ProcessingJob | null> {
  return useQuery({
    queryKey: ['processing-job', assetId],
    queryFn: async () => {
      try {
        return await apiClient.get<ProcessingJob>(`/assets/${assetId}/processing`);
      } catch (err) {
        // 404 means no processing job exists yet — return null instead of throwing
        if (
          err &&
          typeof err === 'object' &&
          'status' in err &&
          (err as { status: number }).status === 404
        ) {
          return null;
        }
        throw err;
      }
    },
    enabled: !!assetId && enabled,
    staleTime: 10_000,
    gcTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000; // Still waiting for job
      if (data.status === 'processing' || data.status === 'queued' || data.status === 'retrying') {
        return 2000;
      }
      return false; // Stop polling once completed or failed
    },
  });
}
