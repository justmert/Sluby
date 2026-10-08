import { useQuery } from '@tanstack/react-query';
import type { VideoAssetStatus } from '@sluby/sdk';
import { failedForGood } from '@/hooks/asset-queries';
import { apiClient } from '@/lib/api-client';
import { sluby } from '@/lib/sluby';

export interface Rendition {
  name: string;
  width: number | null;
  height: number | null;
  video_bitrate_kbps: number | null;
  segment_count: number;
  byte_size: number;
  data_object_id: string;
  playlist_object_id: string;
}

export type ObjectRole = 'master_manifest' | 'variant_playlist' | 'rendition_data' | 'thumbnail';

export interface SiaStorageInfo {
  manifest_object_id: string | null;
  objects: Array<{
    object_id: string;
    role: ObjectRole | null;
    rendition: string | null;
    size: number;
    encoded_size: number;
    slab_count: number;
    sector_count: number;
    shared_slab_count: number;
    host_count: number;
    created_at: string;
  }>;
  unavailable_object_ids: string[];
  totals: {
    object_count: number;
    raw_bytes: number;
    encoded_bytes: number;
    unique_slab_count: number;
    unique_sector_count: number;
    sector_bytes: number;
    data_shards: number | null;
    parity_shards: number | null;
    redundancy_ratio: number | null;
    host_count: number;
    country_count: number;
  };
  hosts: Array<{
    public_key: string;
    sectors: number;
    country_code: string | null;
    latitude: number | null;
    longitude: number | null;
    good_for_upload: boolean | null;
  }>;
  countries: Array<{ country_code: string; hosts: number; sectors: number }>;
  contracts: string[] | null;
  indexer: { url: string; network: string; wallet_address: string | null };
}

export function useAssetRenditions(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['assets', 'renditions', id],
    queryFn: () => apiClient.get<{ data: Rendition[] }>(`/assets/${id}/renditions`),
    enabled: !!id && enabled,
  });
}

export function useAssetSiaInfo(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['assets', 'sia', id],
    queryFn: () => apiClient.get<SiaStorageInfo>(`/assets/${id}/sia`),
    enabled: !!id && enabled,
    // the indexer is the slow part; the server caches for 30s anyway
    staleTime: 30_000,
  });
}

/**
 * The asset's processing job. It is keyed on the asset's status too: the job
 * appears when the upload finishes and restarts on a retry, and both show up
 * as a status change first.
 */
export function useProcessingJob(
  id: string | undefined,
  assetStatus: VideoAssetStatus | undefined,
  enabled: boolean,
  interval = 3_000,
) {
  return useQuery({
    queryKey: ['assets', 'processing', id, assetStatus],
    queryFn: () => sluby.assets.processing(id!),
    enabled: !!id && enabled,
    refetchInterval: (query) => {
      // a 404 (no job yet, or the asset is gone) or a 401 does not change by asking again
      if (failedForGood(query)) return false;
      const s = query.state.data?.status;
      return s === 'completed' || s === 'failed' ? false : interval;
    },
    retry: false,
  });
}
