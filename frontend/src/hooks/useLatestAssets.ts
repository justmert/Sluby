import { useQuery } from '@tanstack/react-query';
import { sluby } from '@/lib/sluby';

export function useLatestAssets(limit = 6) {
  return useQuery({
    queryKey: ['assets', 'latest', limit],
    queryFn: () => sluby.assets.list({ limit, page: 1 }),
    refetchInterval: (query) =>
      // keep polling while anything in view is still moving through the pipeline
      query.state.data?.data.some((a) => a.status !== 'ready' && a.status !== 'failed')
        ? 5_000
        : 30_000,
  });
}
