import { useQuery } from '@tanstack/react-query';
import { sluby } from '@/lib/sluby';
import { failedForGood, isInFlight, useUploadChanges } from './asset-queries';

export function useLatestAssets(limit = 6) {
  useUploadChanges();
  return useQuery({
    queryKey: ['assets', 'latest', limit],
    queryFn: () => sluby.assets.list({ limit, page: 1 }),
    refetchInterval: (query) => {
      if (failedForGood(query)) return false;
      // keep polling while anything in view is still moving through the pipeline
      return query.state.data?.data.some((a) => isInFlight(a)) ? 5_000 : 30_000;
    },
  });
}
