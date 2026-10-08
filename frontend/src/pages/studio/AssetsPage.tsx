import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AccessTier, AssetSortField, VideoAsset, VideoAssetStatus } from '@sluby/sdk';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AssetStatusBadge } from '@/components/asset/AssetStatusBadge';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { jobSummary } from '@/components/asset/processing';
import { AnimatedItem, AnimatedList, FadeSwap, pressable } from '@/components/motion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Progress } from '@/components/ui/progress';
import { ResponsiveCell, ResponsiveTable } from '@/components/ui/responsive-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import { useAssetList, useDeleteAssets } from '@/hooks/asset-queries';
import { useDebounce } from '@/hooks/useDebounce';
import { useFrozen } from '@/hooks/useFrozen';
import { formatBytes, formatDate, formatDuration, formatRelativeTime } from '@/lib/formatters';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 24;

const SORTS = [
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'created_at:asc', label: 'Oldest first' },
  { value: 'title:asc', label: 'Title A to Z' },
  { value: 'title:desc', label: 'Title Z to A' },
  { value: 'duration:desc', label: 'Longest' },
  { value: 'size:desc', label: 'Largest' },
] as const;

const STATUSES: { value: VideoAssetStatus; label: string }[] = [
  { value: 'ready', label: 'Ready' },
  { value: 'processing', label: 'Processing' },
  { value: 'uploading', label: 'Uploading' },
  { value: 'created', label: 'Created' },
  { value: 'failed', label: 'Failed' },
];

const ALL = 'all';

/** Library state lives in the url so a filtered view can be shared or reloaded. */
function useLibraryParams() {
  const [params, setParams] = useSearchParams();
  const sortValue = params.get('sort') ?? 'created_at:desc';
  const [sort, order] = sortValue.split(':') as [AssetSortField, 'asc' | 'desc'];

  const update = (patch: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        // any change other than paging starts over at page one
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  return {
    q: params.get('q') ?? '',
    status: (params.get('status') as VideoAssetStatus | null) ?? undefined,
    tier: (params.get('tier') as AccessTier | null) ?? undefined,
    sortValue,
    sort,
    order,
    page: Math.max(1, Number(params.get('page')) || 1),
    view: (params.get('view') === 'list' ? 'list' : 'grid') as 'grid' | 'list',
    update,
  };
}

function AssetMeta({ asset }: { asset: VideoAsset }) {
  const parts = [
    asset.durationMs ? formatDuration(asset.durationMs) : null,
    asset.resolution || null,
    asset.totalStorageBytes > 0 ? formatBytes(asset.totalStorageBytes) : null,
  ].filter(Boolean);
  return <span>{parts.length ? parts.join(' · ') : formatRelativeTime(asset.createdAt)}</span>;
}

/** Stage and percent of a processing asset; the job polls only while one is on screen. */
function useCardProgress(asset: VideoAsset) {
  const processing = asset.status === 'processing';
  const job = useProcessingJob(asset.id, asset.status, processing, 5_000);
  return processing && job.data ? job.data : undefined;
}

function RowMenu({ asset, onDelete }: { asset: VideoAsset; onDelete: () => void }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-coarse:size-10"
          aria-label={`Actions for ${asset.title}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate(`/studio/assets/${asset.id}`)}>
          Open details
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            navigator.clipboard.writeText(asset.id).then(
              () => toast.success('Asset id copied'),
              () => toast.error('Could not copy: clipboard unavailable'),
            )
          }
        >
          Copy asset id
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssetCard({
  asset,
  selected,
  selecting,
  onSelect,
  onDelete,
}: {
  asset: VideoAsset;
  selected: boolean;
  /** something on the page is selected, so every box stays visible */
  selecting: boolean;
  onSelect: (on: boolean) => void;
  onDelete: () => void;
}) {
  const job = useCardProgress(asset);
  const isPrivate = asset.accessTier === 'private';
  return (
    <Card
      className={cn(
        pressable('group relative h-full gap-0 overflow-hidden py-0'),
        // the card is not a link itself; only links inside it take focus
        'motion-safe:active:scale-100',
        selected && 'ring-2 ring-primary',
      )}
    >
      {/* the title link below names the asset; this one is a larger mouse target */}
      <Link
        to={`/studio/assets/${asset.id}`}
        className="relative block"
        tabIndex={-1}
        aria-hidden="true"
      >
        <AssetThumbnail
          thumbnailObjectIds={asset.thumbnailObjectIds}
          isPrivate={isPrivate}
          className="w-full rounded-none"
          imageClassName="motion-safe:transition-[opacity,scale] motion-safe:duration-300 motion-safe:group-hover:scale-[1.03]"
        />
        {job && (
          <Progress
            value={job.progressPercent}
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 rounded-none bg-transparent"
          />
        )}
      </Link>
      <label
        data-slot="select-target"
        data-visible={selected || selecting || undefined}
        className={cn(
          'absolute top-2 left-2 flex size-8 cursor-pointer items-center justify-center rounded-md border bg-background shadow-sm transition-opacity duration-150',
          // on a mouse the box waits for hover or focus; touch has no hover, so it always shows
          'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-within:opacity-100 pointer-fine:data-visible:opacity-100',
        )}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect(v === true)}
          aria-label={`Select ${asset.title}`}
        />
      </label>
      <div className="flex items-start gap-2 p-3">
        <Link
          to={`/studio/assets/${asset.id}`}
          className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p className="truncate text-sm font-medium" title={asset.title}>
            {asset.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {job ? jobSummary(job) : <AssetMeta asset={asset} />}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <AssetStatusBadge status={asset.status} />
            {isPrivate && (
              <Badge variant="outline">
                <Lock />
                Private
              </Badge>
            )}
          </div>
        </Link>
        <RowMenu asset={asset} onDelete={onDelete} />
      </div>
    </Card>
  );
}

function AssetRow({
  asset,
  selected,
  initial,
  onSelect,
  onDelete,
}: {
  asset: VideoAsset;
  selected: boolean;
  initial: false | undefined;
  onSelect: (on: boolean) => void;
  onDelete: () => void;
}) {
  const job = useCardProgress(asset);
  return (
    <AnimatedItem
      as="tr"
      initial={initial}
      data-slot="table-row"
      data-state={selected ? 'selected' : undefined}
      className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
    >
      <ResponsiveCell cell="primary" className="pl-3">
        <div className="flex min-w-0 items-center gap-3">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelect(v === true)}
            aria-label={`Select ${asset.title}`}
          />
          <Link
            to={`/studio/assets/${asset.id}`}
            className="flex min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <AssetThumbnail
              thumbnailObjectIds={asset.thumbnailObjectIds}
              isPrivate={asset.accessTier === 'private'}
              className="w-16"
            />
            <span className="min-w-0">
              <span className="block max-w-xs truncate font-medium" title={asset.title}>
                {asset.title}
              </span>
              {(job || asset.accessTier === 'private') && (
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {job ? jobSummary(job) : 'Private'}
                </span>
              )}
            </span>
          </Link>
        </div>
      </ResponsiveCell>
      <ResponsiveCell label="Status">
        <AssetStatusBadge status={asset.status} />
      </ResponsiveCell>
      <ResponsiveCell label="Duration" className="hidden tabular-nums md:table-cell">
        {asset.durationMs ? formatDuration(asset.durationMs) : '-'}
      </ResponsiveCell>
      <ResponsiveCell label="Stored" className="hidden tabular-nums md:table-cell">
        {asset.totalStorageBytes > 0 ? formatBytes(asset.totalStorageBytes) : '-'}
      </ResponsiveCell>
      <ResponsiveCell label="Created" className="hidden text-muted-foreground lg:table-cell">
        {formatDate(asset.createdAt)}
      </ResponsiveCell>
      <ResponsiveCell cell="actions" className="pr-3 text-right">
        <RowMenu asset={asset} onDelete={onDelete} />
      </ResponsiveCell>
    </AnimatedItem>
  );
}

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

// skeletons match the real card and row boxes, and only fade in once loading
// has taken 150ms, so a fast answer never flashes them
const SKELETON_REVEAL = 'animate-in fade-in fill-mode-backwards delay-150 duration-200';

function GridSkeleton() {
  return (
    <div className={cn(GRID, SKELETON_REVEAL)} aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <Card key={i} className="gap-0 overflow-hidden py-0" data-testid="asset-card-skeleton">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="p-3">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-3/4" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="mt-2 h-5 w-16 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <Card className={cn('gap-0 py-0', SKELETON_REVEAL)} aria-hidden="true">
      <div className="h-10 border-b" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-[61px] items-center gap-3 border-b px-3 last:border-0">
          <Skeleton className="size-4" />
          <Skeleton className="aspect-video w-16" />
          <Skeleton className="h-3.5 w-48" />
        </div>
      ))}
    </Card>
  );
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** Whether a key press came from somewhere that takes typing. */
function typingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

export default function AssetsPage() {
  const p = useLibraryParams();
  const [searchInput, setSearchInput] = useState(p.q);
  const [syncedQ, setSyncedQ] = useState(p.q);
  const debounced = useDebounce(searchInput, 300);
  const searchRef = useRef<HTMLInputElement>(null);
  // a selection belongs to the view it was made in: another search, filter,
  // sort or page starts empty, so a bulk delete never reaches hidden rows
  const scope = [p.q, p.status, p.tier, p.sortValue, p.page].join('|');
  const [selection, setSelection] = useState<{ scope: string; ids: Set<string> }>({
    scope,
    ids: new Set(),
  });
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const deleteOpen = pendingDelete !== null;
  // the dialog keeps its title while it fades out after pendingDelete clears
  const shownDelete = useFrozen(pendingDelete, deleteOpen);

  // back and forward change ?q= under the box; follow them. typing moves the
  // url too, and then the box already says it
  if (p.q !== syncedQ) {
    setSyncedQ(p.q);
    if (p.q !== searchInput.trim()) setSearchInput(p.q);
  }

  // push the debounced search into the url (which drives the query)
  useEffect(() => {
    if (debounced.trim() !== p.q) p.update({ q: debounced.trim() || null });
    // p.update is rebuilt every render; only the debounced value should trigger this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const list = useAssetList({
    page: p.page,
    limit: PAGE_SIZE,
    search: p.q || undefined,
    status: p.status,
    accessTier: p.tier,
    sort: p.sort,
    order: p.order,
  });
  const deleteAssets = useDeleteAssets();

  const assets = useMemo(() => list.data?.data ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(p.q || p.status || p.tier);
  // only rows on screen count, also after a refetch dropped one
  const selected = useMemo(
    () =>
      new Set(
        selection.scope === scope
          ? assets.filter((a) => selection.ids.has(a.id)).map((a) => a.id)
          : [],
      ),
    [assets, scope, selection],
  );
  const allOnPageSelected = assets.length > 0 && selected.size === assets.length;
  const someOnPageSelected = selected.size > 0 && !allOnPageSelected;
  const pastTheEnd = !!list.data && !list.isPlaceholderData && assets.length === 0 && total > 0;
  const searching = searchInput.trim() !== p.q || (list.isFetching && list.isPlaceholderData);

  // the results on screen belong to the last settled query, not to the url
  // while the next answer is on its way; a new set crossfades in
  const shownKey = useFrozen(`${scope}|${p.view}`, !list.isPlaceholderData);
  // stagger only the first results this page shows, and not even those when
  // they came from the cache (back from an asset, say)
  const [cachedAtMount] = useState(() => list.data !== undefined);
  const [firstKey, setFirstKey] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  if (firstKey === null && list.data && !list.isPlaceholderData) setFirstKey(shownKey);
  if (firstKey !== null && shownKey !== firstKey && !moved) setMoved(true);
  const stagger = !cachedAtMount && !moved;

  const select = (ids: Set<string>) => setSelection({ scope, ids });
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    select(next);
  };
  const selectPage = (on: boolean) => select(new Set(on ? assets.map((a) => a.id) : []));

  // a stale link, or deleting the last rows of the last page, lands past the
  // end; go to the last page that has rows
  useEffect(() => {
    if (pastTheEnd) p.update({ page: pages > 1 ? String(pages) : null });
    // p.update is rebuilt every render; only reaching an empty page should trigger this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastTheEnd, pages]);

  // "/" jumps to the search box, escape lets go of a selection
  const hasSelection = selected.size > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/' && !typingTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && hasSelection && !deleteOpen && !typingTarget(e.target)) {
        setSelection((s) => ({ ...s, ids: new Set() }));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasSelection, deleteOpen]);

  const confirmDelete = async () => {
    const ids = pendingDelete ?? [];
    const titles = new Map(assets.map((a) => [a.id, a.title]));
    setPendingDelete(null);
    const failures = await deleteAssets.mutateAsync(ids);
    // keep what failed selected, so it can be tried again
    const failed = new Set(failures.map((f) => f.id));
    select(new Set([...selected].filter((id) => !ids.includes(id) || failed.has(id))));
    const ok = ids.length - failures.length;
    if (ok > 0) toast.success(`Deleting ${plural(ok, 'video')} from Sia`);
    for (const f of failures) {
      toast.error(`Could not delete "${titles.get(f.id) ?? f.id}": ${f.error}`);
    }
  };

  const selectAll = (
    <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-muted-foreground">
      <Checkbox
        checked={allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false}
        onCheckedChange={(v) => selectPage(v === true)}
        aria-label="Select all on this page"
      />
      <span aria-hidden="true">Select all</span>
    </label>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Assets"
        description={list.data ? plural(total, 'video') : 'Your video library'}
        actions={
          <Button asChild>
            <Link to="/studio/upload">
              <Upload />
              Upload
            </Link>
          </Button>
        }
      />

      {/* sticks under the top bar on wider screens; one row once the page column fits it */}
      <div className="mb-4 flex flex-col gap-3 bg-background md:sticky md:top-14 md:z-10 md:-mx-2 md:px-2 md:py-2 @4xl/page:flex-row @4xl/page:items-center">
        <InputGroup className="@4xl/page:max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            placeholder="Search title, description or asset id"
            aria-label="Search assets"
            aria-keyshortcuts="/"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && searchInput) {
                e.preventDefault();
                setSearchInput('');
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            {searching && <Spinner aria-label="Searching" />}
            {searchInput ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => {
                  setSearchInput('');
                  searchRef.current?.focus();
                }}
              >
                <X />
              </Button>
            ) : (
              <kbd
                aria-hidden="true"
                className="hidden h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[11px] text-muted-foreground pointer-fine:inline-flex"
              >
                /
              </kbd>
            )}
          </InputGroupAddon>
        </InputGroup>
        <div className="flex flex-wrap items-center gap-2">
          {assets.length > 0 && (
            <div className={cn(p.view === 'list' && 'sm:hidden')}>{selectAll}</div>
          )}
          <Select
            value={p.status ?? ALL}
            onValueChange={(v) => p.update({ status: v === ALL ? null : v })}
          >
            <SelectTrigger aria-label="Filter by status" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={p.tier ?? ALL}
            onValueChange={(v) => p.update({ tier: v === ALL ? null : v })}
          >
            <SelectTrigger aria-label="Filter by access" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All access</SelectItem>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="private">Private</SelectItem>
            </SelectContent>
          </Select>
          <Select value={p.sortValue} onValueChange={(v) => p.update({ sort: v })}>
            <SelectTrigger aria-label="Sort" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              className="animate-in duration-150 fade-in"
              onClick={() => {
                setSearchInput('');
                p.update({ q: null, status: null, tier: null });
              }}
            >
              Clear filters
            </Button>
          )}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={p.view}
            onValueChange={(v) =>
              v && p.update({ view: v === 'grid' ? null : v, page: String(p.page) })
            }
            className="ml-auto"
          >
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <LayoutGrid />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {list.isError ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Could not load assets</EmptyTitle>
            <EmptyDescription>{list.error.message}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : list.isLoading ? (
        p.view === 'grid' ? (
          <GridSkeleton />
        ) : (
          <ListSkeleton />
        )
      ) : pastTheEnd ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>This page is empty</EmptyTitle>
            <EmptyDescription>
              The library has {plural(total, 'video')}, on {plural(pages, 'page')}.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() => p.update({ page: pages > 1 ? String(pages) : null })}
            >
              Go to page {pages}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <FadeSwap
          swapKey={assets.length === 0 ? `empty|${shownKey}` : shownKey}
          className={cn('transition-opacity duration-150', list.isPlaceholderData && 'opacity-60')}
        >
          {assets.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Film />
                </EmptyMedia>
                <EmptyTitle>{filtered ? 'No matching videos' : 'No videos yet'}</EmptyTitle>
                <EmptyDescription>
                  {filtered
                    ? 'Nothing matches these filters. Try a different search or clear them.'
                    : 'Upload a video to see it transcoded and pinned to Sia.'}
                </EmptyDescription>
              </EmptyHeader>
              {!filtered && (
                <EmptyContent>
                  <Button asChild>
                    <Link to="/studio/upload">
                      <Upload />
                      Upload video
                    </Link>
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <Results
              key={shownKey}
              view={p.view}
              assets={assets}
              stagger={stagger}
              busy={list.isFetching}
              selected={selected}
              allOnPageSelected={allOnPageSelected}
              someOnPageSelected={someOnPageSelected}
              onSelectPage={selectPage}
              onToggle={toggle}
              onDelete={(id) => setPendingDelete([id])}
            />
          )}
        </FadeSwap>
      )}

      {(total > PAGE_SIZE || p.page > 1) && !pastTheEnd && (
        <div className="mt-6 flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">
            {(p.page - 1) * PAGE_SIZE + 1} to {Math.min(p.page * PAGE_SIZE, total)} of{' '}
            {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={p.page <= 1}
              onClick={() => p.update({ page: String(p.page - 1) })}
            >
              <ChevronLeft />
              <span className="max-sm:sr-only">Previous</span>
            </Button>
            <span className="tabular-nums">
              Page {p.page} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={p.page >= pages}
              onClick={() => p.update({ page: String(p.page + 1) })}
            >
              <span className="max-sm:sr-only">Next</span>
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {hasSelection && (
          <m.div
            key="bulk"
            role="toolbar"
            aria-label="Selected videos"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }}
            className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl border bg-popover py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg"
          >
            <span className="tabular-nums" aria-live="polite">
              {selected.size} of {assets.length} selected
            </span>
            <Button variant="ghost" size="sm" onClick={() => select(new Set())}>
              Clear
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setPendingDelete([...selected])}>
              <Trash2 />
              Delete selected
            </Button>
          </m.div>
        )}
      </AnimatePresence>

      <AlertDialog open={deleteOpen} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{' '}
              {shownDelete?.length === 1 ? 'this video' : `${shownDelete?.length ?? 0} videos`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The asset disappears now and its objects are unpinned from Sia in the background. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

/**
 * One settled set of results. It is keyed on the query and view, so a new
 * set mounts fresh; ids present when it mounted only stagger in when asked,
 * and rows a later poll adds fade in on their own.
 */
function Results({
  view,
  assets,
  stagger,
  busy,
  selected,
  allOnPageSelected,
  someOnPageSelected,
  onSelectPage,
  onToggle,
  onDelete,
}: {
  view: 'grid' | 'list';
  assets: VideoAsset[];
  stagger: boolean;
  busy: boolean;
  selected: Set<string>;
  allOnPageSelected: boolean;
  someOnPageSelected: boolean;
  onSelectPage: (on: boolean) => void;
  onToggle: (id: string, on: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [mountedIds] = useState(() => new Set(assets.map((a) => a.id)));
  const [staggered] = useState(stagger);
  const initialFor = (id: string) => (staggered || !mountedIds.has(id) ? undefined : false);

  if (view === 'grid') {
    return (
      <AnimatedList as="ul" className={GRID} aria-busy={busy}>
        {assets.map((asset) => (
          <AnimatedItem key={asset.id} as="li" initial={initialFor(asset.id)}>
            <AssetCard
              asset={asset}
              selected={selected.has(asset.id)}
              selecting={selected.size > 0}
              onSelect={(on) => onToggle(asset.id, on)}
              onDelete={() => onDelete(asset.id)}
            />
          </AnimatedItem>
        ))}
      </AnimatedList>
    );
  }

  return (
    <Card className="py-0">
      <ResponsiveTable aria-busy={busy}>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => onSelectPage(v === true)}
                  aria-label="Select all rows"
                />
                Video
              </div>
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Duration</TableHead>
            <TableHead className="hidden md:table-cell">Stored</TableHead>
            <TableHead className="hidden lg:table-cell">Created</TableHead>
            <TableHead className="w-10 pr-3">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <AnimatedList
          as="tbody"
          data-slot="table-body"
          className="max-sm:px-3 [&_tr:last-child]:border-0"
        >
          {assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              initial={initialFor(asset.id)}
              selected={selected.has(asset.id)}
              onSelect={(on) => onToggle(asset.id, on)}
              onDelete={() => onDelete(asset.id)}
            />
          ))}
        </AnimatedList>
      </ResponsiveTable>
    </Card>
  );
}
