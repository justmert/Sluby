import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
} from '@tanstack/react-query';
import type { ListAssetsOptions, PaginatedResponse, VideoAsset } from '@sluby/sdk';
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

/** Whether an asset that was in flight before a poll has settled after it. */
export function anySettled(before: VideoAsset[] | undefined, after: VideoAsset[]): boolean {
  if (!before) return false;
  const was = new Set(before.filter((a) => isInFlight(a)).map((a) => a.id));
  return after.some((a) => was.has(a.id) && !isInFlight(a));
}

// ids with a delete on its way, counted so two overlapping deletes of one id
// keep it hidden until both settle. a poll that lands mid-delete can still
// carry these rows (the server has not dropped them yet); lists filter them
// out until the delete settles, so a removed card never comes back and leaves
// again
const pendingDeletes = new Map<string, number>();

/** A page of assets without the rows whose delete is still on its way. */
export function withoutPendingDeletes(page: PaginatedResponse<VideoAsset>) {
  if (pendingDeletes.size === 0) return page;
  return mapPage(page, (rows) => rows.filter((a) => !pendingDeletes.has(a.id)));
}

/** One page of the library, polling while anything on it is still processing. */
export function useAssetList(options: ListAssetsOptions) {
  useUploadChanges();
  const queryClient = useQueryClient();
  const queryKey = ['assets', 'list', options];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const before = queryClient.getQueryData<PaginatedResponse<VideoAsset>>(queryKey);
      const page = await sluby.assets.list(options);
      // the totals count by status; without this they lag a whole stats poll
      if (anySettled(before?.data, page.data)) {
        void queryClient.invalidateQueries({ queryKey: ['stats'] });
      }
      return withoutPendingDeletes(page);
    },
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      !failedForGood(query) && query.state.data?.data.some((a) => isInFlight(a)) ? 5_000 : false,
  });
}

export function useAssetById(id: string | undefined) {
  useUploadChanges();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['assets', 'one', id],
    queryFn: async () => {
      const before = queryClient.getQueryData<VideoAsset>(['assets', 'one', id]);
      const asset = await sluby.assets.get(id!);
      if (before && anySettled([before], [asset])) {
        void queryClient.invalidateQueries({ queryKey: ['stats'] });
      }
      return asset;
    },
    enabled: !!id,
    refetchInterval: (query) =>
      !failedForGood(query) && query.state.data && isInFlight(query.state.data) ? 3_000 : false,
  });
}

type AssetPage = PaginatedResponse<VideoAsset>;
type AssetPages = { pages: AssetPage[]; pageParams: unknown[] };
type AssetMeta = Partial<Pick<VideoAsset, 'title' | 'description' | 'accessTier'>>;

// the queries that hold lists of assets: the library, the dashboard's latest
// uploads and the player's picker. other ['assets', ...] queries hold one
// asset's details, renditions and so on
const LIST_KINDS = new Set(['list', 'latest', 'playable']);
const listQueries = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: ['assets'], predicate: (q) => LIST_KINDS.has(q.queryKey[1] as string) });

// they come in two shapes: one page (library, dashboard) and the player's
// infinite pages
const isPage = (d: unknown): d is AssetPage =>
  !!d && typeof d === 'object' && Array.isArray((d as AssetPage).data);
const isPages = (d: unknown): d is AssetPages =>
  !!d && typeof d === 'object' && Array.isArray((d as AssetPages).pages);

function mapPage(page: AssetPage, fn: (rows: VideoAsset[]) => VideoAsset[]): AssetPage {
  const data = fn(page.data);
  return { ...page, data, total: Math.max(0, page.total - (page.data.length - data.length)) };
}

/** Rewrite the rows of every cached asset list, whatever its shape. */
function mapCachedLists(
  queryClient: ReturnType<typeof useQueryClient>,
  fn: (rows: VideoAsset[]) => VideoAsset[],
) {
  for (const query of listQueries(queryClient)) {
    const data = query.state.data;
    if (isPage(data)) queryClient.setQueryData(query.queryKey, mapPage(data, fn));
    else if (isPages(data)) {
      queryClient.setQueryData(query.queryKey, {
        ...data,
        pages: data.pages.map((p) => (isPage(p) ? mapPage(p, fn) : p)),
      });
    }
  }
}

type Snapshot = Array<[readonly unknown[], unknown]>;

function snapshotLists(queryClient: ReturnType<typeof useQueryClient>): Snapshot {
  return listQueries(queryClient).map((q) => [q.queryKey, q.state.data]);
}

/**
 * Save title, description or access tier. The new values show at once on
 * the asset and in every cached list; a failed save puts the old ones back.
 */
export function useUpdateAssetMeta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AssetMeta }) => sluby.assets.update(id, data),
    onMutate: async ({ id, data }) => {
      // a poll landing mid-save would put the old values back on screen
      await queryClient.cancelQueries({ queryKey: ['assets', 'one', id] });
      const previous = queryClient.getQueryData<VideoAsset>(['assets', 'one', id]);
      const lists = snapshotLists(queryClient);
      if (previous) queryClient.setQueryData(['assets', 'one', id], { ...previous, ...data });
      mapCachedLists(queryClient, (rows) => rows.map((a) => (a.id === id ? { ...a, ...data } : a)));
      return { previous, lists };
    },
    onError: (_err, { id }, context) => {
      if (context?.previous) queryClient.setQueryData(['assets', 'one', id], context.previous);
      for (const [key, data] of context?.lists ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (asset) => {
      queryClient.setQueryData(['assets', 'one', asset.id], asset);
    },
    onSettled: (_asset, _err, { id }) => {
      // titles and tiers show on every list (library, dashboard, player)
      void queryClient.invalidateQueries({
        queryKey: ['assets'],
        predicate: (q) => !(q.queryKey[1] === 'one' && q.queryKey[2] === id),
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

/**
 * Delete several assets; resolves with the ids that failed and why. The
 * rows leave every cached list at once, and the ones that fail come back.
 */
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
    onMutate: async (ids) => {
      // before the first await, so no poll can slip in between
      for (const id of ids) pendingDeletes.set(id, (pendingDeletes.get(id) ?? 0) + 1);
      // lists whose query function is not ours (the dashboard's latest
      // uploads) get the same filter as their answers land in the cache
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return;
        const { queryKey, state } = event.query;
        if (queryKey[0] !== 'assets' || !LIST_KINDS.has(queryKey[1] as string)) return;
        const keep = (rows: VideoAsset[]) => rows.filter((a) => !pendingDeletes.has(a.id));
        const data = state.data;
        // only write when something goes, so the write does not trigger itself
        if (isPage(data) && data.data.some((a) => pendingDeletes.has(a.id))) {
          queryClient.setQueryData(queryKey, mapPage(data, keep));
        } else if (
          isPages(data) &&
          data.pages.some((p) => isPage(p) && p.data.some((a) => pendingDeletes.has(a.id)))
        ) {
          queryClient.setQueryData(queryKey, {
            ...data,
            pages: data.pages.map((p) => (isPage(p) ? mapPage(p, keep) : p)),
          });
        }
      });
      // a list fetch already on its way would answer with the rows still there
      await queryClient.cancelQueries({
        queryKey: ['assets'],
        predicate: (q) => LIST_KINDS.has(q.queryKey[1] as string),
      });
      const lists = snapshotLists(queryClient);
      const removing = new Set(ids);
      mapCachedLists(queryClient, (rows) => rows.filter((a) => !removing.has(a.id)));
      return { lists, unsubscribe };
    },
    onSettled: (failures, err, ids, context) => {
      for (const id of ids) {
        const n = (pendingDeletes.get(id) ?? 1) - 1;
        if (n > 0) pendingDeletes.set(id, n);
        else pendingDeletes.delete(id);
      }
      context?.unsubscribe();
      // a thrown mutation failed every id; otherwise only the listed ones
      const failed = new Set(err ? ids : (failures ?? []).map((f) => f.id));
      const gone = new Set(ids.filter((id) => !failed.has(id)));
      if (failed.size > 0) {
        // put back what failed, where it was, and keep what really went
        for (const [key, data] of context?.lists ?? []) {
          const keep = (rows: VideoAsset[]) => rows.filter((a) => !gone.has(a.id));
          if (isPage(data)) queryClient.setQueryData(key, mapPage(data, keep));
          else if (isPages(data)) {
            queryClient.setQueryData(key, {
              ...data,
              pages: data.pages.map((p) => (isPage(p) ? mapPage(p, keep) : p)),
            });
          }
        }
      }
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
