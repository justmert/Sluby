import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, LayoutGrid, List, Search, X } from 'lucide-react';
import type {
  AccessTier,
  AssetSortField,
  ListAssetsOptions,
  VideoAsset,
  VideoAssetStatus,
} from '@sluby/sdk';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import type { SortState } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageState } from '@/components/shared/PageState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BulkBar } from '@/components/videos/BulkBar';
import { FilterPopover } from '@/components/videos/FilterPopover';
import {
  ACCESS_FILTERS,
  ALL,
  SORT_FIELDS,
  STATUS_FILTERS,
  type SortColumn,
} from '@/components/videos/filters';
import { PreviewSheet } from '@/components/videos/PreviewSheet';
import { videoActions } from '@/components/videos/video-actions';
import { VideosGrid } from '@/components/videos/VideosGrid';
import { VideosTable } from '@/components/videos/VideosTable';
import {
  SELECT_ALL_CAP,
  errorStatus,
  fetchAllMatching,
  useAssetById,
  useAssetList,
  useDeleteAssets,
  useSetAccess,
  useStaleUploadCount,
} from '@/hooks/asset-queries';
import { useAssetStats } from '@/hooks/useStats';
import { useDebounce } from '@/hooks/useDebounce';
import { isTypingTarget, useSlashToSearch } from '@/hooks/useSlashToSearch';
import { ROUTES } from '@/lib/constants';
import { errorText, withLead } from '@/lib/errors';
import { formatCount, plural } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { lateReveal } from '@/lib/motion';
import { toastError, toastSuccess } from '@/lib/toast';
import { useUploadSheet } from '@/lib/upload-sheet';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 24;

type View = 'table' | 'grid';
type Order = 'asc' | 'desc';

const STATUS_VALUES = new Set<string>(STATUS_FILTERS.map((s) => s.value));
const TIER_VALUES = new Set<string>(ACCESS_FILTERS.map((a) => a.value));
const SORT_VALUES = new Set<string>(Object.values(SORT_FIELDS));
const DEFAULT_SORT = 'created_at:desc';

// the grid has no headers to click, so it keeps a sort menu with every
// order the table's headers can make
const GRID_SORTS = [
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'created_at:asc', label: 'Oldest first' },
  { value: 'title:asc', label: 'Title A to Z' },
  { value: 'title:desc', label: 'Title Z to A' },
  { value: 'duration:desc', label: 'Longest first' },
  { value: 'duration:asc', label: 'Shortest first' },
  { value: 'size:desc', label: 'Largest first' },
  { value: 'size:asc', label: 'Smallest first' },
];

const VIEW_KEY = 'sluby:videos-view';

function storedView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'grid' || v === 'table' ? v : null;
  } catch (err) {
    // storage off (a private window, a policy): the url still carries the view
    console.warn('Could not read the remembered library view', err);
    return null;
  }
}

function rememberView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (err) {
    console.warn('Could not remember the library view', err);
  }
}

/**
 * Library state lives in the url so a filtered view can be shared, reloaded
 * and walked back with Back (FLW-25). Values the api would refuse are read
 * as unset and dropped from the url (FLW-24), so a stale bookmark loads the
 * library instead of an error.
 */
function useLibraryParams() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  const bad: string[] = [];
  const read = (key: string, ok: (v: string) => boolean) => {
    const v = params.get(key);
    if (v === null) return undefined;
    if (ok(v)) return v;
    bad.push(key);
    return undefined;
  };
  const status = read('status', (v) => STATUS_VALUES.has(v)) as VideoAssetStatus | undefined;
  const tier = read('tier', (v) => TIER_VALUES.has(v)) as AccessTier | undefined;
  const sortValue =
    read('sort', (v) => {
      const [field, order, extra] = v.split(':');
      return SORT_VALUES.has(field) && (order === 'asc' || order === 'desc') && extra === undefined;
    }) ?? DEFAULT_SORT;
  const [sort, order] = sortValue.split(':') as [AssetSortField, Order];
  const page = Number(read('page', (v) => /^[1-9]\d{0,5}$/.test(v)) ?? 1);
  // "list" is what the view was called before the table became the default
  const viewParam = read('view', (v) => v === 'table' || v === 'grid' || v === 'list');
  const view: View =
    viewParam === 'grid' ? 'grid' : viewParam ? 'table' : (storedView() ?? 'table');
  const preview = params.get('preview');

  const badKey = bad.join(',');
  useEffect(() => {
    if (!badKey) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of badKey.split(',')) next.delete(k);
        return next;
      },
      { replace: true, state: location.state },
    );
    // only a new set of bad keys should trigger this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badKey]);

  /** Change params; any change but paging starts over at page one and closes the preview. */
  const update = (
    patch: Record<string, string | null>,
    { replace = false, state }: { replace?: boolean; state?: unknown } = {},
  ) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        if (!('page' in patch) && !('preview' in patch)) next.delete('page');
        if (!('preview' in patch)) next.delete('preview');
        return next;
      },
      { replace, state },
    );
  };

  return {
    q: params.get('q') ?? '',
    status,
    tier,
    sortValue,
    sort,
    order,
    page,
    view,
    preview,
    update,
  };
}

// skeletons match the real card boxes, and only fade in once loading has
// taken 150ms, so a fast answer never flashes them
function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 @xl/page:grid-cols-2 @4xl/page:grid-cols-3 @6xl/page:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <Card key={i} className="gap-0 overflow-hidden py-0" data-testid="asset-card-skeleton">
          <Skeleton className={cn('aspect-video w-full rounded-none', lateReveal)} />
          <div className="p-3">
            <div className="flex h-5 items-center">
              <Skeleton className={cn('h-3.5 w-3/4', lateReveal)} />
            </div>
            <div className="mt-0.5 flex h-4 items-center">
              <Skeleton className={cn('h-3 w-1/2', lateReveal)} />
            </div>
            <Skeleton className={cn('mt-2 h-5 w-16 rounded-full', lateReveal)} />
          </div>
        </Card>
      ))}
    </div>
  );
}

interface Selection {
  /** the filters and sort it was made under; another set starts empty */
  key: string;
  /** the page it was made on, or null once it spans every result */
  page: number | null;
  ids: Set<string>;
  /** the videos of an every-result selection, fetched page by page */
  across: VideoAsset[];
}

type PendingDelete = { assets: VideoAsset[]; fromBar: boolean };
type PendingAccess = { assets: VideoAsset[]; tier: AccessTier };

const describeDelete = (d: PendingDelete) => {
  if (d.assets.length > 1) {
    return 'They are removed from your library now and from Sia in the background. This cannot be undone.';
  }
  const [a] = d.assets;
  // an upload that never got its file has nothing on Sia (FLW-12)
  const onSia = a.status !== 'created' && a.status !== 'uploading';
  return (
    <>
      “{a.title}” is removed from your library now{onSia && ' and from Sia in the background'}. This
      cannot be undone.
    </>
  );
};

export default function AssetsPage() {
  const p = useLibraryParams();
  const navigate = useNavigate();
  const location = useLocation();
  const uploadSheet = useUploadSheet();
  const [searchInput, setSearchInput] = useState(p.q);
  const [syncedQ, setSyncedQ] = useState(p.q);
  const debounced = useDebounce(searchInput, 300);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // a typing session makes one history entry: the first keystroke that
  // reaches the url pushes, the rest replace it (FLW-25). the session ends on
  // blur, on any other change, or when the url's q is no longer what typing
  // wrote (Back, a link)
  const typing = useRef<{ active: boolean; wrote: string }>({ active: false, wrote: '' });
  useSlashToSearch(searchRef);

  // back and forward change ?q= under the box; follow them. typing moves the
  // url too, and then the box already says it
  if (p.q !== syncedQ) {
    setSyncedQ(p.q);
    if (p.q !== searchInput.trim()) setSearchInput(p.q);
  }

  // push the debounced search into the url (which drives the query)
  useEffect(() => {
    const q = debounced.trim();
    if (q === p.q) return;
    const continuing = typing.current.active && typing.current.wrote === p.q;
    p.update({ q: q || null }, { replace: continuing });
    typing.current = { active: true, wrote: q };
    // p.update is rebuilt every render; only the debounced value should trigger this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  /** a deliberate change (a filter, sort, page, view): its own history entry */
  const go = (patch: Record<string, string | null>) => {
    typing.current.active = false;
    p.update(patch);
  };

  const filters: Omit<ListAssetsOptions, 'page' | 'limit'> = {
    search: p.q || undefined,
    status: p.status,
    accessTier: p.tier,
    sort: p.sort,
    order: p.order,
  };
  const list = useAssetList({ ...filters, page: p.page, limit: PAGE_SIZE });
  const stats = useAssetStats();
  const stale = useStaleUploadCount();
  const deleteAssets = useDeleteAssets();
  const setAccess = useSetAccess();

  const assets = useMemo(() => list.data?.data ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(p.q || p.status || p.tier);
  const filterKey = [p.q, p.status, p.tier, p.sortValue].join('|');

  // selection
  const [selection, setSelection] = useState<Selection>({
    key: filterKey,
    page: p.page,
    ids: new Set(),
    across: [],
  });
  const inScope =
    selection.key === filterKey && (selection.page === null || selection.page === p.page);
  const acrossPages = inScope && selection.page === null;
  // only rows on screen count, also after a poll dropped one; a selection
  // across pages holds ids that are not on this page
  const selected = useMemo(() => {
    if (!inScope) return new Set<string>();
    if (acrossPages) return selection.ids;
    return new Set(assets.filter((a) => selection.ids.has(a.id)).map((a) => a.id));
  }, [inScope, acrossPages, selection, assets]);
  const selectedAssets = useMemo(
    () =>
      acrossPages
        ? selection.across.filter((a) => selection.ids.has(a.id))
        : assets.filter((a) => selected.has(a.id)),
    [acrossPages, selection, assets, selected],
  );
  const hasSelection = selected.size > 0;
  const allOnPage = assets.length > 0 && assets.every((a) => selected.has(a.id));
  const someOnPage = !allOnPage && assets.some((a) => selected.has(a.id));
  const [selectingAll, setSelectingAll] = useState(false);

  const select = (ids: Set<string>) =>
    setSelection((s) =>
      inScope ? { ...s, ids } : { key: filterKey, page: p.page, ids, across: [] },
    );
  const clearSelection = () =>
    setSelection({ key: filterKey, page: p.page, ids: new Set(), across: [] });
  const selectPage = (on: boolean) => {
    const next = new Set(selected);
    for (const a of assets) {
      if (on) next.add(a.id);
      else next.delete(a.id);
    }
    select(next);
  };

  const selectAllResults = async () => {
    setSelectingAll(true);
    try {
      const rows = await fetchAllMatching(filters);
      setSelection({
        key: filterKey,
        page: null,
        ids: new Set(rows.map((a) => a.id)),
        across: rows,
      });
    } catch (err) {
      if (errorStatus(err) !== 401) toastError(withLead('Could not select every result', err));
    } finally {
      setSelectingAll(false);
    }
  };

  // the visible select-all box: the toolbar's in the grid and in the phone
  // cards, the table header's otherwise
  const focusSelectAll = () => {
    const boxes = document.querySelectorAll<HTMLElement>(
      '[role="checkbox"][aria-label="Select all on this page"]',
    );
    const shown = [...boxes].find((b) => b.checkVisibility?.({ visibilityProperty: true }) ?? true);
    (shown ?? searchRef.current)?.focus();
  };

  // states
  const invalidFilters = list.isError && errorStatus(list.error) === 400;
  const deleting = deleteAssets.isPending;
  // a delete that emptied the page waits for the server's answer for that
  // page instead of jumping by the shrunken count (FLW-03)
  const moveAfterDelete = useRef(false);
  const settled = !!list.data && !list.isPlaceholderData && !list.isFetching && !deleting;
  const waitingForRows =
    assets.length === 0 && total > 0 && (deleting || list.isFetching) && !list.isPlaceholderData;
  const pastTheEnd = settled && assets.length === 0 && total > 0;
  const searching = searchInput.trim() !== p.q || (list.isFetching && list.isPlaceholderData);

  useEffect(() => {
    if (!settled) return;
    if (!pastTheEnd || !moveAfterDelete.current) {
      if (assets.length > 0) moveAfterDelete.current = false;
      return;
    }
    moveAfterDelete.current = false;
    p.update(
      { page: Math.min(p.page, pages) > 1 ? String(Math.min(p.page, pages)) : null },
      {
        replace: true,
      },
    );
    // p.update is rebuilt every render; only reaching an empty page should trigger this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, pastTheEnd, assets.length]);

  // the results on screen belong to the last settled query, not to the url
  // while the next answer is on its way
  const queryKey = `${filterKey}|${p.page}|${p.view}`;
  const [shownKey, setShownKey] = useState(queryKey);
  if (shownKey !== queryKey && list.data && !list.isPlaceholderData) setShownKey(queryKey);
  // stagger only the first results this page shows, and not even those when
  // they came from the cache (back from a video, say)
  const [cachedAtMount] = useState(() => list.data !== undefined);
  const [firstKey] = useState(queryKey);
  const staggerIn = !cachedAtMount && shownKey === firstKey;

  // one polite region for what changes without moving focus: the selection
  // count and, once a search or filter settles, how many videos match
  // (A11Y-15, A11Y-21). always mounted, so the first message is read
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef<{ results: string | null; selected: number }>({
    results: null,
    selected: 0,
  });
  const resultsKey = settled ? filterKey : null;
  useEffect(() => {
    if (resultsKey === null || announced.current.results === resultsKey) return;
    const first = announced.current.results === null;
    announced.current.results = resultsKey;
    if (first && !filtered) return;
    setAnnouncement(total === 0 ? 'No matching videos' : plural(total, 'video'));
    // only a newly settled result set should announce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsKey]);
  useEffect(() => {
    const n = selected.size;
    if (n === announced.current.selected) return;
    announced.current.selected = n;
    setAnnouncement(n > 0 ? `${formatCount(n)} selected` : 'Selection cleared');
  }, [selected.size]);

  // dialogs and the preview
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingAccess, setPendingAccess] = useState<PendingAccess | null>(null);
  const [changing, setChanging] = useState<AccessTier | null>(null);
  const focusSearchAfter = useRef(false);

  const previewOnPage = p.preview ? assets.find((a) => a.id === p.preview) : undefined;
  const previewFetched = useAssetById(p.preview && !previewOnPage ? p.preview : undefined);
  const previewAsset = previewOnPage ?? previewFetched.data ?? null;
  const ready = assets.filter((a) => a.status === 'ready');
  const previewIndex = previewAsset ? ready.findIndex((a) => a.id === previewAsset.id) : -1;
  const openedPreviewHere =
    (location.state as { previewOpened?: boolean } | null)?.previewOpened === true;
  const openPreview = (asset: VideoAsset) =>
    p.update({ preview: asset.id }, { state: { previewOpened: true } });
  const closePreview = () => {
    if (openedPreviewHere) void navigate(-1);
    else p.update({ preview: null }, { replace: true });
  };
  // a preview link to a video that is gone or not ready closes itself
  const previewGone =
    !!p.preview &&
    !previewOnPage &&
    (previewFetched.isError || (previewFetched.data && previewFetched.data.status !== 'ready'));
  useEffect(() => {
    if (previewGone) p.update({ preview: null }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewGone]);

  const actionsFor = (asset: VideoAsset) =>
    videoActions(asset, {
      open: (a) => void navigate(ROUTES.video(a.id)),
      preview: openPreview,
      delete: (a) => setPendingDelete({ assets: [a], fromBar: false }),
    });

  // "/" is the shared hook; escape lets go of a selection unless something
  // on top (a menu, a dialog, the preview) takes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !hasSelection) return;
      if (pendingDelete || pendingAccess || p.preview || isTypingTarget(e.target)) return;
      if (
        (e.target as Element | null)?.closest?.('[role="menu"], [role="listbox"], [role="dialog"]')
      )
        return;
      clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const confirmDelete = async ({ assets: doomed, fromBar }: PendingDelete) => {
    const ids = doomed.map((a) => a.id);
    const titles = new Map(doomed.map((a) => [a.id, a.title]));
    moveAfterDelete.current = true;
    const failures = await deleteAssets.mutateAsync(ids);
    const failed = new Set(failures.map((f) => f.id));
    const gone = new Set(ids.filter((id) => !failed.has(id)));
    // keep what failed selected, so it can be tried again
    setSelection((s) => ({
      ...s,
      ids: new Set([...s.ids].filter((id) => !gone.has(id))),
      across: s.across.filter((a) => !gone.has(a.id)),
    }));
    focusSearchAfter.current = fromBar && failures.length === 0;
    const ok = gone.size;
    if (ok > 0) toastSuccess(ok === 1 ? 'Video deleted' : `${formatCount(ok)} videos deleted`);
    if (failures.length > 3) {
      toastError(`Could not delete ${plural(failures.length, 'video')}. ${failures[0].error}`);
    } else {
      for (const f of failures) {
        toastError(`Could not delete “${titles.get(f.id) ?? f.id}”. ${f.error}`);
      }
    }
  };

  const confirmAccess = async ({ assets: targets, tier }: PendingAccess) => {
    setChanging(tier);
    try {
      const failures = await setAccess.mutateAsync({ assets: targets, accessTier: tier });
      const ok = targets.length - failures.length;
      if (ok > 0) {
        toastSuccess(`${ok === 1 ? '1 video is' : `${formatCount(ok)} videos are`} now ${tier}`);
      }
      if (failures.length > 0) {
        // a 412: someone edited it since this page loaded. the list reloads
        // after the change, so trying again uses the latest version
        const stale = failures.every((f) => errorStatus(f.error) === 412);
        toastError(
          stale
            ? `Could not change ${plural(failures.length, 'video')}. ${failures.length === 1 ? 'It was' : 'They were'} changed somewhere else, so try again`
            : `Could not change ${plural(failures.length, 'video')}. ${errorText(failures[0].error)}`,
        );
      }
    } finally {
      setChanging(null);
    }
  };

  const askAccess = (tier: AccessTier) => {
    const targets = selectedAssets.filter((a) => a.accessTier !== tier);
    if (targets.length === 0) {
      toastSuccess(
        selectedAssets.length === 1
          ? `This video is already ${tier}`
          : `These videos are already ${tier}`,
      );
      return;
    }
    setPendingAccess({ assets: targets, tier });
  };

  // drop files anywhere on the page to upload them (D-08). the open upload
  // sheet has its own drop zone, so drops go there while it shows
  const [dragging, setDragging] = useState(false);
  const sheet = useRef(uploadSheet);
  useEffect(() => {
    sheet.current = uploadSheet;
  });
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      !sheet.current.isOpen && !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...e.dataTransfer!.files];
      if (files.length > 0) sheet.current.open(files);
    };
    document.addEventListener('dragenter', enter);
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragenter', enter);
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
    };
  }, []);

  const clearFilters = () => {
    setSearchInput('');
    go({ q: null, status: null, tier: null });
  };

  const goToPage = (page: number) => {
    go({ page: page > 1 ? String(page) : null });
    // the next page starts at its top, under the sticky toolbar (FLW-32)
    resultsRef.current?.scrollIntoView({ block: 'start' });
  };

  const uploadButton = (
    <Button onClick={() => uploadSheet.open()}>
      <Icons.upload />
      Upload video
    </Button>
  );

  // nothing to show at all: the shared page state replaces the whole page,
  // header included, since it carries the page's h1. a failed poll over rows
  // already on screen keeps them; the next poll tries again
  if (list.isError && !list.data) {
    return (
      <PageContainer>
        {invalidFilters ? (
          <PageState
            title="Could not load your videos"
            error={list.error}
            description="These filters are not valid."
            actions={<Button onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <PageState
            title="Could not load your videos"
            error={list.error}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
            actions={
              filtered && (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        )}
      </PageContainer>
    );
  }

  const sort: SortState = {
    column:
      (Object.entries(SORT_FIELDS).find(([, field]) => field === p.sort)?.[0] as SortColumn) ??
      'created',
    direction: p.order,
  };
  const onSort = (s: SortState) =>
    go({ sort: `${SORT_FIELDS[s.column as SortColumn]}:${s.direction}` });

  const statsLine = stats.data
    ? `${plural(stats.data.total, 'video')}${
        stats.data.by_status.processing > 0
          ? `, ${formatCount(stats.data.by_status.processing)} processing`
          : ''
      }`
    : null;

  const selectAllBox = (
    <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-muted-foreground">
      <Checkbox
        checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
        onCheckedChange={(v) => selectPage(v === true)}
        aria-label="Select all on this page"
      />
      {/* the grid's phone toolbar also holds the sort menu; the box alone is enough there */}
      <span aria-hidden="true" className={cn(p.view === 'grid' && 'max-[27rem]:hidden')}>
        Select all
      </span>
    </label>
  );

  const results = list.isLoading ? (
    p.view === 'grid' ? (
      <GridSkeleton />
    ) : (
      <VideosTable
        assets={undefined}
        sort={sort}
        onSortChange={onSort}
        selected={selected}
        onSelectedChange={select}
        actions={actionsFor}
        staggerIn={false}
        busy
        rowsKey="loading"
      />
    )
  ) : waitingForRows ? (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-16 text-muted-foreground"
    >
      <Spinner aria-hidden="true" />
      Loading the next videos…
    </div>
  ) : pastTheEnd ? (
    <EmptyState
      variant="section"
      icon={Icons.video}
      title="Nothing on this page"
      description={
        filtered
          ? `These filters match ${plural(total, 'video')} on ${plural(pages, 'page')}.`
          : `Your library has ${plural(total, 'video')} on ${plural(pages, 'page')}.`
      }
      action={
        <Button variant="outline" onClick={() => goToPage(pages)}>
          Go to page {pages}
        </Button>
      }
    />
  ) : assets.length === 0 ? (
    filtered ? (
      <EmptyState
        variant="section"
        icon={Search}
        title="No matching videos"
        description="Nothing matches these filters. Try a different search or clear them."
        action={
          <Button variant="outline" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        variant="section"
        icon={Icons.video}
        title="No videos yet"
        description="Upload a video and it will be ready to stream in a few minutes."
        action={uploadButton}
      />
    )
  ) : p.view === 'grid' ? (
    <VideosGrid
      key={shownKey}
      assets={assets}
      selected={selected}
      onSelectedChange={select}
      actions={actionsFor}
      staggerIn={staggerIn}
      busy={list.isFetching}
    />
  ) : (
    <VideosTable
      assets={assets}
      sort={sort}
      onSortChange={onSort}
      selected={selected}
      onSelectedChange={select}
      actions={actionsFor}
      staggerIn={staggerIn}
      busy={list.isFetching}
      rowsKey={shownKey}
    />
  );

  return (
    <PageContainer className="flex flex-col">
      <PageHeader
        title="Videos"
        description={
          statsLine ?? (
            // a placeholder of the line's size; a p cannot hold the skeleton's div
            <span
              aria-hidden="true"
              className={cn('inline-block h-4 w-32 rounded-md bg-muted align-middle', lateReveal)}
            />
          )
        }
        primaryAction={uploadButton}
      />

      {/* sticks under the top bar on wider screens that are tall enough for it (A11Y-24) */}
      <div className="z-10 -mx-2 mb-3 flex flex-col gap-2 bg-background px-2 py-2 md:[@media(min-height:40rem)]:sticky md:[@media(min-height:40rem)]:top-14 @2xl/page:flex-row @2xl/page:items-center">
        <InputGroup className="@2xl/page:max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            placeholder="Search by title, description or video ID"
            aria-label="Search videos"
            aria-keyshortcuts="/"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => (typing.current.active = false)}
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
              <Kbd aria-hidden="true" className="hidden pointer-fine:inline-flex">
                /
              </Kbd>
            )}
          </InputGroupAddon>
        </InputGroup>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {assets.length > 0 && (
            <div className={cn(p.view === 'table' && 'hidden @max-[calc(40rem+2px)]/page:block')}>
              {selectAllBox}
            </div>
          )}
          <FilterPopover
            className="@2xl/page:hidden"
            status={p.status}
            tier={p.tier}
            onStatusChange={(v) => go({ status: v ?? null })}
            onTierChange={(v) => go({ tier: v ?? null })}
            onClear={clearFilters}
          />
          <Select
            value={p.status ?? ALL}
            onValueChange={(v) => go({ status: v === ALL ? null : v })}
          >
            <SelectTrigger aria-label="Filter by status" className="hidden w-40 @2xl/page:flex">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={p.tier ?? ALL} onValueChange={(v) => go({ tier: v === ALL ? null : v })}>
            <SelectTrigger aria-label="Filter by access" className="hidden w-32 @2xl/page:flex">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All access</SelectItem>
              {ACCESS_FILTERS.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {p.view === 'grid' && (
            <Select value={p.sortValue} onValueChange={(v) => go({ sort: v })}>
              <SelectTrigger aria-label="Sort" className="w-auto min-w-34">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRID_SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-2">
            {filtered && (
              // on phones the Filter menu and the search box's own clear do this
              <Button
                variant="ghost"
                size="sm"
                className="hidden @2xl/page:inline-flex"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            )}
            <ToggleGroup
              type="single"
              variant="segmented"
              size="sm"
              value={p.view}
              aria-label="View"
              onValueChange={(v) => {
                if (v !== 'table' && v !== 'grid') return;
                rememberView(v);
                go({ view: v, page: p.page > 1 ? String(p.page) : null });
              }}
            >
              <ToggleGroupItem value="table" aria-label="Table view">
                <List />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <LayoutGrid />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </div>

      {/* first in the tab order after the filters, last on screen: it sticks
            to the bottom of the content column (A11Y-15, VIS-18) */}
      <AnimatePresence>
        {hasSelection && (
          <BulkBar
            key="bulk"
            className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] order-last mt-4"
            count={selected.size}
            onPage={assets.length}
            total={total}
            acrossPages={acrossPages}
            selectingAll={selectingAll}
            cap={SELECT_ALL_CAP}
            changing={changing}
            onSelectAll={() => void selectAllResults()}
            onMakePublic={() => askAccess('public')}
            onMakePrivate={() => askAccess('private')}
            onDelete={() => setPendingDelete({ assets: selectedAssets, fromBar: true })}
            onClear={() => {
              clearSelection();
              focusSelectAll();
            }}
          />
        )}
      </AnimatePresence>

      {(stale.data ?? 0) > 0 && p.status !== 'created' && (
        <p className="mb-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          {stale.data === 1
            ? '1 upload never started.'
            : `${formatCount(stale.data!)} uploads never started.`}
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => go({ status: 'created', tier: null, q: null })}
          >
            Show them
          </Button>
        </p>
      )}

      <div
        ref={resultsRef}
        className={cn(
          'scroll-mt-20 transition-opacity duration-150',
          list.isPlaceholderData && 'opacity-60',
        )}
        onKeyDown={(e) => {
          // space on a video's title previews it, like a file browser
          if (e.key !== ' ' || e.defaultPrevented) return;
          const id = (e.target as HTMLElement).getAttribute('data-video-link');
          const asset = id ? assets.find((a) => a.id === id) : undefined;
          if (asset?.status !== 'ready') return;
          e.preventDefault();
          openPreview(asset);
        }}
      >
        {results}
      </div>

      {(total > PAGE_SIZE || p.page > 1) && !pastTheEnd && !list.isLoading && (
        <nav
          aria-label="Pages"
          className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm"
        >
          <span className="text-muted-foreground tabular-nums">
            {formatCount(Math.min((p.page - 1) * PAGE_SIZE + 1, total))} to{' '}
            {formatCount(Math.min(p.page * PAGE_SIZE, total))} of {formatCount(total)}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={p.page <= 1}
              onClick={() => goToPage(p.page - 1)}
            >
              <ChevronLeft />
              <span className="max-sm:sr-only">Previous</span>
            </Button>
            <span className="tabular-nums">
              Page {formatCount(p.page)} of {formatCount(pages)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={p.page >= pages}
              onClick={() => goToPage(p.page + 1)}
            >
              <span className="max-sm:sr-only">Next</span>
              <ChevronRight />
            </Button>
          </div>
        </nav>
      )}

      <p className="sr-only" role="status">
        {announcement}
      </p>

      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-6 duration-150 animate-in fade-in-0"
        >
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary bg-card px-10 py-8 text-center shadow-lg">
            <Icons.upload className="size-6 text-primary" />
            <p className="font-heading text-heading">Drop to upload</p>
            <p className="text-sm text-muted-foreground">
              Each video is converted for streaming and stored on Sia.
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        item={pendingDelete}
        onClose={() => setPendingDelete(null)}
        title={(d) =>
          d.assets.length === 1
            ? 'Delete this video?'
            : `Delete ${formatCount(d.assets.length)} videos?`
        }
        description={describeDelete}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        errorTitle={
          pendingDelete?.assets.length === 1
            ? 'Could not delete the video'
            : 'Could not delete the videos'
        }
        onConfirm={confirmDelete}
        onCloseAutoFocus={(e) => {
          // the bar that opened it went away with the selection (A11Y-15)
          if (!focusSearchAfter.current) return;
          focusSearchAfter.current = false;
          e.preventDefault();
          searchRef.current?.focus();
        }}
      />

      <ConfirmDialog
        item={pendingAccess}
        onClose={() => setPendingAccess(null)}
        destructive={false}
        title={(a) => {
          const what =
            a.assets.length === 1 ? 'this video' : `${formatCount(a.assets.length)} videos`;
          return `Make ${what} ${a.tier}?`;
        }}
        description={(a) =>
          a.tier === 'private'
            ? 'Players without a signed URL stop working within a minute. Viewers who already have a link keep it until it expires.'
            : a.assets.length === 1
              ? 'Anyone with the stream URL can play it.'
              : 'Anyone with the stream URL can play them.'
        }
        confirmLabel={pendingAccess?.tier === 'private' ? 'Make private' : 'Make public'}
        pendingLabel="Saving…"
        errorTitle="Could not change the videos"
        onConfirm={confirmAccess}
      />

      <PreviewSheet
        asset={p.preview && previewAsset && previewAsset.status === 'ready' ? previewAsset : null}
        onClose={closePreview}
        previous={previewIndex > 0 ? ready[previewIndex - 1] : null}
        next={previewIndex >= 0 && previewIndex < ready.length - 1 ? ready[previewIndex + 1] : null}
        onStep={(a) => p.update({ preview: a.id }, { replace: true, state: location.state })}
      />
    </PageContainer>
  );
}
