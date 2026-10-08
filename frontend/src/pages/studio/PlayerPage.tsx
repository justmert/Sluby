import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Film, Search } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AssetPlayer } from '@/components/asset/AssetPlayer';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { AnimatedItem, AnimatedList, FadeSwap } from '@/components/motion';
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
import { Spinner } from '@/components/ui/spinner';
import { AssetStatusBadge } from '@/components/asset/AssetStatusBadge';
import { useAssetById, useUploadChanges } from '@/hooks/asset-queries';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDuration } from '@/lib/formatters';
import { usePrefersReducedMotion } from '@/lib/motion';
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

/** Whether a key press came from somewhere that takes typing. */
function typingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

type Playable = ReturnType<typeof usePlayableAssets>;

/**
 * One search's results. Keyed on the search, so ids present when it mounts
 * stagger in only on the page's first load; "Show more" rows fade in.
 */
function PlayableList({
  assets,
  stagger,
  selectedId,
  onPick,
}: {
  assets: NonNullable<Playable['data']>['pages'][number]['data'];
  stagger: boolean;
  selectedId: string | undefined;
  onPick: (id: string) => void;
}) {
  const [mountedIds] = useState(() => new Set(assets.map((a) => a.id)));
  const [staggered] = useState(stagger);
  return (
    <AnimatedList as="ul" className="flex flex-col gap-1">
      {assets.map((a) => (
        <AnimatedItem
          key={a.id}
          as="li"
          initial={staggered || !mountedIds.has(a.id) ? undefined : false}
        >
          <button
            type="button"
            aria-current={a.id === selectedId ? 'true' : undefined}
            onClick={() => onPick(a.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
              a.id === selectedId && 'bg-muted',
            )}
          >
            <AssetThumbnail
              thumbnailObjectIds={a.thumbnailObjectIds}
              isPrivate={a.accessTier === 'private'}
              className="w-16"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium" title={a.title}>
                {a.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDuration(a.durationMs ?? 0)}
              </span>
            </span>
          </button>
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}

/** Pick any ready video and play it the way an embedding app would. */
export default function PlayerPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('asset') ?? undefined;
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  const debounced = useDebounce(search.trim(), 300);
  const list = usePlayableAssets(debounced);
  const selected = useAssetById(selectedId);
  const assets = list.data?.pages.flatMap((page) => page.data) ?? [];
  const total = list.data?.pages[0]?.total;
  const searchRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const [cachedAtMount] = useState(() => list.data !== undefined);
  const [firstSearch] = useState(debounced);

  // back and forward move ?q= under the box; follow them
  if (q !== syncedQ) {
    setSyncedQ(q);
    if (q !== search.trim()) setSearch(q);
  }

  // the search lives in the url like the library's, so a reload keeps it
  useEffect(() => {
    if (debounced === q) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debounced) next.set('q', debounced);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
    // setParams is stable enough; only a settled search should write the url
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/' && !typingTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pick = (id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('asset', id);
      return next;
    });
    // on phones the list sits under the player; bring the player back up
    const el = playerRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Player"
        description="Preview any ready video with @sluby/player, the same component apps embed"
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card ref={playerRef} className="scroll-mt-20 lg:col-span-2">
          <CardContent>
            <FadeSwap swapKey={!selectedId ? 'none' : selected.isLoading ? 'loading' : selectedId}>
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
            </FadeSwap>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ready videos</CardTitle>
            <CardDescription>
              {/* a no-break space holds the line until the count arrives */}
              {total !== undefined ? `${total.toLocaleString()} playable` : ' '}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                ref={searchRef}
                placeholder="Search"
                aria-label="Search ready videos"
                aria-keyshortcuts="/"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                {search.trim() !== debounced || (list.isFetching && !list.isFetchingNextPage) ? (
                  <Spinner aria-label="Searching" />
                ) : (
                  !search && (
                    <kbd
                      aria-hidden="true"
                      className="hidden h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[11px] text-muted-foreground pointer-fine:inline-flex"
                    >
                      /
                    </kbd>
                  )
                )}
              </InputGroupAddon>
            </InputGroup>
            <div className="max-h-[60vh] overflow-y-auto">
              {list.isLoading ? (
                <ul className="flex flex-col gap-1" aria-hidden="true">
                  {Array.from({ length: 4 }, (_, i) => (
                    <li key={i}>
                      <Skeleton className="h-[52px]" />
                    </li>
                  ))}
                </ul>
              ) : assets.length > 0 ? (
                <PlayableList
                  key={debounced}
                  assets={assets}
                  stagger={!cachedAtMount && debounced === firstSearch}
                  selectedId={selectedId}
                  onPick={pick}
                />
              ) : (
                list.data && (
                  <p className="text-sm text-muted-foreground">
                    {/* the list answers the debounced search, so that decides the wording */}
                    {debounced ? (
                      'No ready videos match.'
                    ) : (
                      <>
                        No ready videos yet.{' '}
                        <Link to="/studio/upload" className="underline underline-offset-4">
                          Upload a video
                        </Link>{' '}
                        to play it here once it is transcoded.
                      </>
                    )}
                  </p>
                )
              )}
            </div>
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
                {list.isFetchingNextPage && <Spinner aria-hidden="true" />}
                {list.isFetchingNextPage ? 'Loading...' : 'Show more'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
