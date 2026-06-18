import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types (mirror the backend JSON shapes using snake_case from the API)
// ---------------------------------------------------------------------------

export type VideoAssetStatus =
  | 'created'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed';

export type AccessTier =
  | 'public'
  | 'private';

export interface VideoAsset {
  id: string;
  title: string;
  description: string;
  manifest_object_id: string | null;
  thumbnail_object_ids: string[];
  duration_ms: number;
  resolution: string;
  status: VideoAssetStatus;
  access_tier: AccessTier;
  creator_address: string;
  segment_count: number;
  total_storage_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface UseAssetsOptions {
  page?: number;
  limit?: number;
  status?: VideoAssetStatus;
  accessTier?: AccessTier;
  creatorAddress?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAssets(
  options: UseAssetsOptions = {},
): UseQueryResult<PaginatedResponse<VideoAsset>> {
  const { page = 1, limit = 20, status, accessTier, creatorAddress, search } = options;

  return useQuery({
    queryKey: ['assets', { page, limit, status, accessTier, creatorAddress, search }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (status) params.set('status', status);
      if (accessTier) params.set('access_tier', accessTier);
      if (creatorAddress) params.set('creator_address', creatorAddress);
      if (search) params.set('search', search);
      return apiClient.get<PaginatedResponse<VideoAsset>>(`/assets?${params.toString()}`);
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Sia info types
// ---------------------------------------------------------------------------

export interface SiaObjectSummary {
  size: number;
  slabCount: number;
  sectorCount: number;
  minShards: number;
  totalShards: number;
  createdAt: string | null;
  updatedAt: string | null;
  hosts: string[];
}

export interface SiaVariantInfo {
  resolution: string;
  bitrateKbps: number;
  dataObjectId: string;
  playlistObjectId: string;
  dataSize: number;
  segmentCount: number;
  hostCount: number;
  hosts: string[];
  slabCount: number;
  sectorCount: number;
  encodedBytes: number | null;
  minShards: number | null;
  totalShards: number | null;
}

export interface SiaThumbnailInfo {
  objectId: string;
  size: number;
}

export interface AssetSiaInfo {
  manifestObjectId: string | null;
  manifest: SiaObjectSummary | null;
  variants: SiaVariantInfo[];
  thumbnails: SiaThumbnailInfo[];
  totals: {
    objectCount: number;
    rawBytes: number;
    encodedBytes: number | null;
    redundancyRatio: number | null;
    dataShards: number | null;
    parityShards: number | null;
    uniqueHostCount: number;
    allHosts: string[];
  };
  indexer: {
    url: string;
    network: 'zen' | 'mainnet';
  };
}

export function useAssetSiaInfo(id?: string): UseQueryResult<AssetSiaInfo> {
  return useQuery({
    queryKey: ['assets', id, 'sia'],
    queryFn: () => apiClient.get<AssetSiaInfo>(`/assets/${id}/sia`),
    enabled: !!id,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useAsset(id?: string): UseQueryResult<VideoAsset> {
  return useQuery({
    queryKey: ['assets', id],
    queryFn: () => apiClient.get<VideoAsset>(`/assets/${id}`),
    enabled: !!id,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    refetchOnWindowFocus: false,
  });
}

export function useUpdateAsset(): UseMutationResult<
  VideoAsset,
  Error,
  { id: string; data: Partial<{ title: string; description: string; access_tier: string }> }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) =>
      apiClient.patch<VideoAsset>(`/assets/${id}`, data),
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['assets', id] });

      // Snapshot the previous value
      const previous = queryClient.getQueryData<VideoAsset>(['assets', id]);

      // Optimistically update the single-asset cache
      if (previous) {
        queryClient.setQueryData<VideoAsset>(['assets', id], {
          ...previous,
          ...data,
        } as unknown as VideoAsset);
      }

      return { previous };
    },
    onError: (_err, { id }, context) => {
      // Roll back to the previous value on error
      if (context?.previous) {
        queryClient.setQueryData(['assets', id], context.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      // Always refetch after error or success to ensure server state
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets', id] });
    },
  });
}

export function useDeleteAsset(): UseMutationResult<
  { success: boolean },
  Error,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: boolean }>(`/assets/${id}`),
    onMutate: async (id) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['assets'] });

      // Snapshot all asset-related queries for rollback
      const previousQueries = queryClient.getQueriesData<PaginatedResponse<VideoAsset>>({
        queryKey: ['assets'],
      });

      // Optimistically remove the asset from all list queries
      queryClient.setQueriesData<PaginatedResponse<VideoAsset>>(
        { queryKey: ['assets'] },
        (old) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.filter((asset) => asset.id !== id),
            total: old.total - 1,
          };
        },
      );

      return { previousQueries };
    },
    onError: (_err, _id, context) => {
      // Roll back all queries to previous state on error
      if (context?.previousQueries) {
        for (const [key, data] of context.previousQueries) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure server state
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}
