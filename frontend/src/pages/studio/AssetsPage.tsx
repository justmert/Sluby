import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAssetList, useDeleteAssets } from '@/hooks/asset-queries';
import { useDebounce } from '@/hooks/useDebounce';
import { formatBytes, formatDate, formatDuration, formatRelativeTime } from '@/lib/formatters';

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
    view: params.get('view') === 'list' ? 'list' : 'grid',
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

function RowMenu({ asset, onDelete }: { asset: VideoAsset; onDelete: () => void }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${asset.title}`}>
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
  onSelect,
  onDelete,
}: {
  asset: VideoAsset;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Card className="group relative gap-0 py-0">
      <Link to={`/studio/assets/${asset.id}`} className="block">
        <AssetThumbnail
          thumbnailObjectIds={asset.thumbnailObjectIds}
          className="w-full rounded-none"
        />
      </Link>
      <div className="absolute top-2 left-2">
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect(v === true)}
          aria-label={`Select ${asset.title}`}
          className="bg-background/80"
        />
      </div>
      <div className="flex items-start gap-2 p-3">
        <Link to={`/studio/assets/${asset.id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={asset.title}>
            {asset.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            <AssetMeta asset={asset} />
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <AssetStatusBadge status={asset.status} />
            {asset.accessTier === 'private' && (
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

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export default function AssetsPage() {
  const p = useLibraryParams();
  const [searchInput, setSearchInput] = useState(p.q);
  const debounced = useDebounce(searchInput, 300);
  // a selection belongs to the view it was made in: another search, filter,
  // sort or page starts empty, so a bulk delete never reaches hidden rows
  const scope = [p.q, p.status, p.tier, p.sortValue, p.page].join('|');
  const [selection, setSelection] = useState<{ scope: string; ids: Set<string> }>({
    scope,
    ids: new Set(),
  });
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);

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

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <InputGroup className="lg:max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search title, description or asset id"
            aria-label="Search assets"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <InputGroupAddon align="inline-end">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setSearchInput('')}
              >
                <X />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
        <div className="flex flex-wrap items-center gap-2">
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
            className="lg:ml-auto"
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

      {assets.length > 0 && (
        <div className="mb-4 flex min-h-11 items-center gap-3 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm">
          <Checkbox
            id="select-page"
            checked={allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false}
            onCheckedChange={(v) => selectPage(v === true)}
            aria-label="Select all on this page"
          />
          <label htmlFor="select-page" className="cursor-pointer" aria-hidden="true">
            {selected.size > 0 ? `${selected.size} of ${assets.length} selected` : 'Select all'}
          </label>
          {selected.size > 0 && (
            <>
              <Button variant="ghost" size="sm" onClick={() => select(new Set())}>
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() => setPendingDelete([...selected])}
              >
                <Trash2 />
                Delete selected
              </Button>
            </>
          )}
        </div>
      )}

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />
          ))}
        </div>
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
      ) : assets.length === 0 ? (
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
      ) : p.view === 'grid' ? (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-busy={list.isFetching}
        >
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              selected={selected.has(asset.id)}
              onSelect={(on) => toggle(asset.id, on)}
              onDelete={() => setPendingDelete([asset.id])}
            />
          ))}
        </div>
      ) : (
        <Card className="py-0">
          <Table aria-busy={list.isFetching}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false
                    }
                    onCheckedChange={(v) => selectPage(v === true)}
                    aria-label="Select all rows"
                  />
                </TableHead>
                <TableHead>Video</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Duration</TableHead>
                <TableHead className="hidden md:table-cell">Stored</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((asset) => (
                <TableRow
                  key={asset.id}
                  data-state={selected.has(asset.id) ? 'selected' : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(asset.id)}
                      onCheckedChange={(v) => toggle(asset.id, v === true)}
                      aria-label={`Select ${asset.title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/studio/assets/${asset.id}`}
                      className="flex min-w-0 items-center gap-3"
                    >
                      <AssetThumbnail
                        thumbnailObjectIds={asset.thumbnailObjectIds}
                        className="w-16"
                      />
                      <span className="min-w-0">
                        <span className="block max-w-xs truncate font-medium" title={asset.title}>
                          {asset.title}
                        </span>
                        {asset.accessTier === 'private' && (
                          <span className="text-xs text-muted-foreground">Private</span>
                        )}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <AssetStatusBadge status={asset.status} />
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">
                    {asset.durationMs ? formatDuration(asset.durationMs) : '-'}
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">
                    {asset.totalStorageBytes > 0 ? formatBytes(asset.totalStorageBytes) : '-'}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {formatDate(asset.createdAt)}
                  </TableCell>
                  <TableCell>
                    <RowMenu asset={asset} onDelete={() => setPendingDelete([asset.id])} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
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
              Previous
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
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{' '}
              {pendingDelete?.length === 1 ? 'this video' : `${pendingDelete?.length} videos`}?
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
