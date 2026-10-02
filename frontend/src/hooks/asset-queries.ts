import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListAssetsOptions, VideoAsset } from '@sluby/sdk';
import { sluby } from '@/lib/sluby';

const inFlight = (a: VideoAsset) => a.status !== 'ready' && a.status !== 'failed';

/** One page of the library, polling while anything on it is still processing. */
export function useAssetList(options: ListAssetsOptions) {
  return useQuery({
    queryKey: ['assets', 'list', options],
    queryFn: () => sluby.assets.list(options),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.data.some(inFlight) ? 5_000 : false),
  });
}

export function useAssetById(id: string | undefined) {
  return useQuery({
    queryKey: ['assets', 'one', id],
    queryFn: () => sluby.assets.get(id!),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data && inFlight(query.state.data) ? 3_000 : false),
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
      void queryClient.invalidateQueries({ queryKey: ['assets', 'list'] });
    },
  });
}

/** Delete several assets; resolves with the ids that failed and why. */
export function useDeleteAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => sluby.assets.delete(id)));
      return results.flatMap((r, i) =>
        r.status === 'rejected'
          ? [{ id: ids[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) }]
          : [],
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
