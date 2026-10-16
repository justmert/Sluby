import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
} from '@tanstack/react-query';
import type { ListAssetsOptions, VideoAsset } from '@sluby/sdk';
import { sluby } from '@/lib/sluby';
import { uploadStore } from '@/lib/studio-upload';

// the backend forgets an unfinished tus upload after a day and sweeps its
// asset; a `created` asset older than that is not going anywhere
const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** The HTTP status of an sdk or api-client error, if it has one. */
export function errorStatus(err: unknown): number | undefined {
  const e = err as { statusCode?: unknown; status?: unknown } | null;
  if (typeof e?.statusCode === 'number' && e.statusCode > 0) return e.statusCode;
  if (typeof e?.status === 'number') return e.status;
  return undefined;
}

const isClientError = (err: unknown) => {
  const status = errorStatus(err);
  return status !== undefined && status >= 400 && status < 500;
};

/** Whether polling the query again could change anything. */
export const failedForGood = (query: Pick<Query, 'state'>) =>
  query.state.status === 'error' && isClientError(query.state.error);

/** Whether an asset is still moving through upload and processing. */
export function isInFlight(asset: VideoAsset, now = Date.now()): boolean {
  if (asset.status === 'ready' || asset.status === 'failed') return false;
  if (asset.status === 'created' || asset.status === 'uploading') {
    return now - Date.parse(asset.createdAt) < UPLOAD_EXPIRY_MS;
  }
  return true;
}

// the version of the upload store's asset changes these hooks already acted
// on; module wide so several hooks on one page invalidate once
let handledAssetVersion = 0;

/**
 * Refetch asset lists and stats when a studio upload created, finished or
 * removed an asset, including changes made while no page was watching.
 */
export function useUploadChanges() {
  const queryClient = useQueryClient();
  const version = useSyncExternalStore(
    uploadStore.subscribe,
    () => uploadStore.getState().assetVersion,
  );
  useEffect(() => {
    if (version <= handledAssetVersion) return;
    handledAssetVersion = version;
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  }, [queryClient, version]);
}

/** One page of the library, polling while anything on it is still processing. */
export function useAssetList(options: ListAssetsOptions) {
  useUploadChanges();
  return useQuery({
    queryKey: ['assets', 'list', options],
    queryFn: () => sluby.assets.list(options),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      !failedForGood(query) && query.state.data?.data.some((a) => isInFlight(a)) ? 5_000 : false,
  });
}

export function useAssetById(id: string | undefined) {
  useUploadChanges();
  return useQuery({
    queryKey: ['assets', 'one', id],
    queryFn: () => sluby.assets.get(id!),
    enabled: !!id,
    refetchInterval: (query) =>
      !failedForGood(query) && query.state.data && isInFlight(query.state.data) ? 3_000 : false,
  });
}

export function useUpdateAssetMeta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Pick<VideoAsset, 'title' | 'description' | 'accessTier'>>;
    }) => sluby.assets.update(id, data),
    onSuccess: (asset) => {
      queryClient.setQueryData(['assets', 'one', asset.id], asset);
      // titles and tiers show on every list (library, dashboard, player)
      void queryClient.invalidateQueries({
        queryKey: ['assets'],
        predicate: (q) => !(q.queryKey[1] === 'one' && q.queryKey[2] === asset.id),
      });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/** Restart processing of a failed asset. */
export function useRetryProcessing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sluby.assets.retry(id),
    onSuccess: (_result, id) => {
      // the server moved it back to processing; show that now so the page
      // follows the new run instead of the failure it already knows
      queryClient.setQueryData<VideoAsset>(['assets', 'one', id], (old) =>
        old ? { ...old, status: 'processing' } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export interface DeleteFailure {
  id: string;
  error: string;
}

/** Delete several assets; resolves with the ids that failed and why. */
export function useDeleteAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<DeleteFailure[]> => {
      const results = await Promise.allSettled(ids.map((id) => sluby.assets.delete(id)));
      return results.flatMap((r, i) =>
        // already gone is what a delete asks for
        r.status === 'rejected' && errorStatus(r.reason) !== 404
          ? [{ id: ids[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) }]
          : [],
      );
    },
    onSettled: (failures, _err, ids) => {
      const failed = new Set((failures ?? []).map((f) => f.id));
      const gone = new Set(ids.filter((id) => !failed.has(id)));
      // drop the deleted assets' own queries instead of refetching them into
      // 404s; a page still showing one removes its queries once it navigates
      // away, since removing a watched query makes it fetch again
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ['assets'] })) {
        const id = query.queryKey[2];
        if (typeof id === 'string' && gone.has(id) && query.getObserversCount() === 0) {
          queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
        }
      }
      void queryClient.invalidateQueries({
        queryKey: ['assets'],
        predicate: (q) => !(typeof q.queryKey[2] === 'string' && gone.has(q.queryKey[2])),
      });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/** Remove every query of one asset; call once nothing shows it any more. */
export function useForgetAsset() {
  const queryClient = useQueryClient();
  return useCallback(
    (id: string) => {
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ['assets'] })) {
        if (query.queryKey[2] === id) {
          queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
        }
      }
    },
    [queryClient],
  );
}
