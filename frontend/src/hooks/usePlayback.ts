import {
  useQuery,
  useMutation,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaybackInfo {
  playback_url: string;
  poster_url: string | null;
  duration_ms: number;
  resolution: string;
  access_tier: string;
}

export interface SignedPlaybackInfo {
  signedUrl: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function usePlayback(assetId?: string): UseQueryResult<PlaybackInfo> {
  return useQuery({
    queryKey: ['playback', assetId],
    queryFn: () => apiClient.get<PlaybackInfo>(`/playback/${assetId}`),
    enabled: !!assetId,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    refetchOnWindowFocus: false,
  });
}

export function useSignedPlayback(): UseMutationResult<
  SignedPlaybackInfo,
  Error,
  { assetId: string; expiresIn?: number }
> {
  return useMutation({
    mutationFn: ({ assetId, expiresIn = 3600 }) =>
      apiClient.get<SignedPlaybackInfo>(`/playback/${assetId}/signed?expires_in=${expiresIn}`),
  });
}
