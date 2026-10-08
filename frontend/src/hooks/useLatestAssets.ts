import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sluby } from '@/lib/sluby';
import { failedForGood, isInFlight, useUploadChanges } from './asset-queries';

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
