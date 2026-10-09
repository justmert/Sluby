import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { VideoAsset } from '@sluby/sdk';
import { sluby } from '@/lib/sluby';
import { uploadStore } from '@/lib/studio-upload';
import { isTransferring, useUploads } from '@/lib/upload-store';
import { failedForGood, isInFlight, useUploadChanges } from './asset-queries';

/** An upload whose file has not arrived for this long counts as interrupted. */
export const STALLED_AFTER_MS = 10 * 60_000;

export function useLatestAssets(limit = 6) {
  useUploadChanges();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['assets', 'latest', limit],
    queryFn: () => sluby.assets.list({ limit, page: 1 }),
    refetchInterval: (query) => {
      if (failedForGood(query)) return false;
      // keep polling while anything in view is still moving through the pipeline
      return query.state.data?.data.some((a) => isInFlight(a)) ? 5_000 : 30_000;
    },
  });

  // the totals poll on their own clock; when a row here settles, ask for them
  // now so the stat cards never disagree with the list beside them
  const moving = useRef<Set<string> | null>(null);
  const assets = query.data?.data;
  useEffect(() => {
    if (!assets) return;
    const now = new Set(assets.filter((a) => isInFlight(a)).map((a) => a.id));
    const before = moving.current;
    moving.current = now;
    if (before && [...before].some((id) => !now.has(id))) {
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  }, [assets, queryClient]);

  return query;
}

/**
 * Whether a video is a placeholder whose file never arrived: waiting for its
 * file, or uploading, with nothing heard for STALLED_AFTER_MS, and not being
 * sent from this browser right now.
 */
export function isStalled(asset: VideoAsset, sending: ReadonlySet<string>, now = Date.now()) {
  if (asset.status !== 'created' && asset.status !== 'uploading') return false;
  if (sending.has(asset.id)) return false;
  // the server moves a video to uploading when the first bytes arrive, and does
  // not touch it again until the upload completes
  const since = Date.parse(asset.status === 'uploading' ? asset.updatedAt : asset.createdAt);
  return now - since > STALLED_AFTER_MS;
}

/** Video ids this browser is sending right now. */
export function useSendingIds(): Set<string> {
  const { uploads } = useUploads(uploadStore);
  return new Set(
    uploads.filter((u) => isTransferring(u) && u.assetId).map((u) => u.assetId as string),
  );
}

const ATTENTION_ROWS = 5;

/** The newest failed videos and how many there are. */
export function useFailedVideos() {
  return useQuery({
    queryKey: ['assets', 'attention', 'failed'],
    queryFn: () => sluby.assets.list({ status: 'failed', limit: ATTENTION_ROWS, page: 1 }),
    refetchInterval: (query) => (failedForGood(query) ? false : 30_000),
  });
}

/** The oldest videos still waiting for their file or uploading, to find interrupted uploads among. */
export function useWaitingVideos() {
  const list = (status: 'created' | 'uploading') => ({
    queryKey: ['assets', 'attention', status],
    queryFn: () =>
      sluby.assets.list({
        status,
        sort: 'created_at',
        order: 'asc',
        limit: ATTENTION_ROWS,
        page: 1,
      }),
    refetchInterval: 60_000,
  });
  const created = useQuery(list('created'));
  const uploading = useQuery(list('uploading'));
  return { created, uploading };
}

/** One ready video to point the embed code step at; only asked for when one exists. */
export function useFirstReadyVideo(enabled: boolean) {
  return useQuery({
    queryKey: ['assets', 'first-ready'],
    queryFn: () => sluby.assets.list({ status: 'ready', limit: 1, page: 1 }),
    enabled,
    select: (page) => page.data[0] ?? null,
  });
}
