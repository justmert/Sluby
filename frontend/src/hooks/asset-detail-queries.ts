import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProcessingJob, VideoAsset, VideoAssetStatus } from '@sluby/sdk';
import { failedForGood, useSendingAssetIds } from '@/hooks/asset-queries';
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

/** Poll fast while the job moves, slowly while it sits still (FLW-26). */
export const JOB_POLL_FAST_MS = 2_000;
export const JOB_POLL_SLOW_MS = 10_000;
/** How long a job may sit without a change before polling slows down. */
export const JOB_STILL_AFTER_MS = 10_000;

// what changes when a job moves on: stage, percent, status and new log lines
const jobSignature = (job: ProcessingJob | undefined) =>
  job ? `${job.status}:${job.stage}:${job.progressPercent}:${job.logs.length}` : '';

export interface JobPollState {
  signature: string;
  /** when the job last changed */
  at: number;
}

/**
 * How long to wait before reading a running job again, and the state to
 * keep for the next call: 2 seconds while it moves, 10 once it has not
 * changed for 10 seconds.
 */
export function nextJobPoll(
  job: ProcessingJob | undefined,
  last: JobPollState,
  now: number,
): { delay: number; state: JobPollState } {
  const signature = jobSignature(job);
  const state = signature === last.signature ? last : { signature, at: now };
  const delay = now - state.at < JOB_STILL_AFTER_MS ? JOB_POLL_FAST_MS : JOB_POLL_SLOW_MS;
  return { delay, state };
}

/**
 * The asset's processing job. It is keyed on the asset's status too: the job
 * appears when the upload finishes and restarts on a retry, and both show up
 * as a status change first. While the job runs it is read every 2 seconds
 * while it moves and every 10 once it has sat still for 10 seconds (a long
 * wait for the Sia uploader, say); react query stops polling while the tab
 * is hidden.
 */
export function useProcessingJob(
  id: string | undefined,
  assetStatus: VideoAssetStatus | undefined,
  enabled: boolean,
  /** a fixed interval instead of the fast-then-slow one */
  interval?: number,
) {
  const seen = useRef<JobPollState>({ signature: '', at: 0 });
  return useQuery({
    queryKey: ['assets', 'processing', id, assetStatus],
    queryFn: () => sluby.assets.processing(id!),
    enabled: !!id && enabled,
    refetchInterval: (query) => {
      // a 404 (no job yet, or the asset is gone) or a 401 does not change by asking again
      if (failedForGood(query)) return false;
      const job = query.state.data;
      if (job?.status === 'completed' || job?.status === 'failed') return false;
      if (interval !== undefined) return interval;
      const { delay, state } = nextJobPoll(job, seen.current, Date.now());
      seen.current = state;
      return delay;
    },
    retry: false,
  });
}

/** Whether this browser, in this tab or another, is sending the file of the asset right now. */
export function useSendingHere(assetId: string | undefined): boolean {
  const sending = useSendingAssetIds();
  return assetId ? sending.has(assetId) : false;
}

type VideoPatch = Partial<Pick<VideoAsset, 'title' | 'description' | 'accessTier'>>;

/**
 * Save one field of a video. `base` is the video as the edit started from:
 * it goes out as If-Match, so a change made elsewhere since then comes back
 * as a 412 ConflictError instead of being overwritten (B-13, FLW-06). Only
 * the field that changed is sent.
 */
export function useUpdateVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ base, patch }: { base: VideoAsset; patch: VideoPatch }) =>
      sluby.assets.update(base.id, patch, { ifMatch: base }),
    onSuccess: (asset) => {
      queryClient.setQueryData(['assets', 'one', asset.id], asset);
      // titles and access show on every list (library, overview, palette)
      void queryClient.invalidateQueries({
        queryKey: ['assets'],
        predicate: (q) => !(q.queryKey[1] === 'one' && q.queryKey[2] === asset.id),
      });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
