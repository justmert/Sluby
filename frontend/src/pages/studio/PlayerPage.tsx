import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Film, Search } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AssetPlayer } from '@/components/asset/AssetPlayer';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { AssetStatusBadge } from '@/components/asset/AssetStatusBadge';
import { useAssetById, useUploadChanges } from '@/hooks/asset-queries';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDuration } from '@/lib/formatters';
import { sluby } from '@/lib/sluby';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 30;

/** Ready videos, newest first, a page at a time. */
function usePlayableAssets(search: string) {
  useUploadChanges();
  return useInfiniteQuery({
    queryKey: ['assets', 'playable', search],
    queryFn: ({ pageParam }) =>
      sluby.assets.list({
        status: 'ready',
        limit: PAGE_SIZE,
        search: search || undefined,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Pick any ready video and play it the way an embedding app would. */
export default function PlayerPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('asset') ?? undefined;
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const list = usePlayableAssets(debounced);
  const selected = useAssetById(selectedId);
  const assets = list.data?.pages.flatMap((page) => page.data) ?? [];
  const total = list.data?.pages[0]?.total;

  return (
    <PageContainer>
      <PageHeader
        title="Player"
        description="Preview any ready video with @sluby/player, the same component apps embed"
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            {!selectedId ? (
              <Empty className="aspect-video">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Film />
                  </EmptyMedia>
                  <EmptyTitle>Pick a video</EmptyTitle>
                  <EmptyDescription>
                    Choose a ready video from the list to play it.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : selected.isLoading ? (
              <Skeleton className="aspect-video w-full" />
            ) : selected.data && selected.data.status !== 'ready' ? (
              <Empty className="aspect-video">
                <EmptyHeader>
                  <EmptyTitle>{selected.data.title} is not ready to play</EmptyTitle>
                  <EmptyDescription>
                    <span className="inline-flex items-center gap-2">
                      Its status is <AssetStatusBadge status={selected.data.status} />
                    </span>
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" asChild>
                    <Link to={`/studio/assets/${selected.data.id}`}>Open the asset</Link>
                  </Button>
                </EmptyContent>
              </Empty>
            ) : selected.data ? (
              <div className="flex flex-col gap-3">
                <AssetPlayer
                  key={selected.data.id}
                  assetId={selected.data.id}
                  signed={selected.data.accessTier === 'private'}
                />
                <div className="flex items-center justify-between gap-4">
                  <p className="truncate font-medium" title={selected.data.title}>
                    {selected.data.title}
                  </p>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/studio/assets/${selected.data.id}`}>Asset details</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-destructive">
                Could not load this video: {selected.error?.message}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ready videos</CardTitle>
            <CardDescription>
              {total !== undefined ? `${total.toLocaleString()} playable` : ' '}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Search"
                aria-label="Search ready videos"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
              {list.isLoading &&
                Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}
              {assets.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-current={a.id === selectedId ? 'true' : undefined}
                    onClick={() => setParams({ asset: a.id })}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-muted',
                      a.id === selectedId && 'bg-muted',
                    )}
                  >
                    <AssetThumbnail thumbnailObjectIds={a.thumbnailObjectIds} className="w-16" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium" title={a.title}>
                        {a.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(a.durationMs ?? 0)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {list.data &&
                assets.length === 0 &&
                // the list answers the debounced search, so that decides the wording
                (debounced ? (
                  <li className="text-sm text-muted-foreground">No ready videos match.</li>
                ) : (
                  <li className="text-sm text-muted-foreground">
                    No ready videos yet.{' '}
                    <Link to="/studio/upload" className="underline underline-offset-4">
                      Upload a video
                    </Link>{' '}
                    to play it here once it is transcoded.
                  </li>
                ))}
            </ul>
            {list.isError && (
              <p className="text-sm text-destructive">
                Could not load videos: {list.error.message}
              </p>
            )}
            {list.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? 'Loading...' : 'Show more'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
