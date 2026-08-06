import { useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutGrid,
  List,
  Search,
  X,
  Upload,
  Film,
  Pencil,
  Trash2,
  HardDrive,
  Clock,
  CheckSquare,
  Loader2,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  useAssets,
  useDeleteAsset,
  type VideoAsset,
  type VideoAssetStatus,
  type AccessTier,
} from '@/hooks/useAssets';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDuration, formatBytes, formatRelativeTime } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import { siaObjectUrl } from '@/lib/sia';
import { ObjectIdBadge } from '@/components/shared/ObjectIdBadge';

// ---------------------------------------------------------------------------
// Inline shared badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }
  > = {
    created: { label: 'Created', variant: 'secondary' },
    uploading: { label: 'Uploading', variant: 'warning' },
    processing: { label: 'Processing', variant: 'warning' },
    ready: { label: 'Ready', variant: 'success' },
    failed: { label: 'Failed', variant: 'destructive' },
  };
  const c = config[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function AccessTierBadge({ tier }: { tier: string }) {
  const config: Record<
    string,
    { label: string; variant: 'default' | 'secondary' | 'warning' | 'success' }
  > = {
    public: { label: 'Public', variant: 'success' },
    private: { label: 'Private', variant: 'default' },
  };
  const c = config[tier] ?? { label: tier, variant: 'secondary' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

// ---------------------------------------------------------------------------
// Video Card (Grid view)
// ---------------------------------------------------------------------------

function VideoCard({
  asset,
  isSelecting,
  isSelected,
  onToggleSelect,
}: {
  asset: VideoAsset;
  isSelecting: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  return (
    <div className="relative">
      {isSelecting && (
        <div
          className="absolute top-2.5 left-2.5 z-10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect(asset.id);
          }}
        >
          <Checkbox checked={isSelected} />
        </div>
      )}
      <Link
        to={isSelecting ? '#' : `/studio/assets/${asset.id}`}
        onClick={(e) => {
          if (isSelecting) {
            e.preventDefault();
            onToggleSelect(asset.id);
          }
        }}
      >
        <div
          className={cn(
            'group cursor-pointer bg-white/[0.03] border rounded-2xl hover:bg-white/[0.05] hover:border-white/[0.12] hover:shadow-lg hover:shadow-teal-500/5 transition-all duration-200 overflow-hidden card-glow',
            isSelected ? 'border-teal-500/40 ring-1 ring-teal-500/20' : 'border-white/[0.08]',
          )}
        >
          {/* Thumbnail */}
          <div className="relative aspect-video bg-white/[0.01] flex items-center justify-center overflow-hidden">
            {asset.thumbnail_object_ids?.[0] ? (
              <img
                src={siaObjectUrl(asset.thumbnail_object_ids[0])}
                alt={asset.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <Film className="w-8 h-8 text-zinc-600" />
            )}
            {/* Duration overlay */}
            {asset.duration_ms > 0 && (
              <span className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm text-white text-[10px] font-mono px-1.5 py-0.5 rounded-md">
                {formatDuration(asset.duration_ms)}
              </span>
            )}
          </div>
          {/* Info */}
          <div className="p-3.5">
            <p className="text-sm font-medium text-zinc-200 truncate">{asset.title}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <StatusBadge status={asset.status} />
              <AccessTierBadge tier={asset.access_tier} />
            </div>
            <div className="flex items-center justify-between mt-2.5 text-xs text-zinc-500">
              <span className="flex items-center gap-1">
                <HardDrive className="w-3 h-3" />
                {formatBytes(asset.total_storage_bytes)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatRelativeTime(asset.created_at)}
              </span>
            </div>
            {asset.manifest_object_id && (
              <div
                className="mt-2 pt-2 border-t border-white/[0.06]"
                onClick={(e) => e.stopPropagation()}
              >
                <ObjectIdBadge
                  value={asset.manifest_object_id}
                  truncate={6}
                  className="text-[10px]"
                />
              </div>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function AssetListRow({
  asset,
  isSelecting,
  isSelected,
  onToggleSelect,
}: {
  asset: VideoAsset;
  isSelecting: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const deleteAsset = useDeleteAsset();

  return (
    <Link
      to={isSelecting ? '#' : `/studio/assets/${asset.id}`}
      onClick={(e) => {
        if (isSelecting) {
          e.preventDefault();
          onToggleSelect(asset.id);
        }
      }}
      className={cn(
        'group flex items-center gap-4 px-4 py-3 hover:bg-white/[0.05] transition-colors duration-150',
        isSelected && 'bg-teal-500/5',
      )}
    >
      {/* Selection checkbox */}
      {isSelecting && (
        <div
          className="shrink-0"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect(asset.id);
          }}
        >
          <Checkbox checked={isSelected} />
        </div>
      )}

      {/* Small thumbnail */}
      <div className="w-20 h-[45px] rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 overflow-hidden">
        {asset.thumbnail_object_ids?.[0] ? (
          <img
            src={siaObjectUrl(asset.thumbnail_object_ids[0])}
            alt={asset.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Film className="w-4 h-4 text-zinc-600" />
        )}
      </div>

      {/* Title + ID */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200 truncate">{asset.title}</p>
        <p className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">
          {asset.id.slice(0, 12)}
        </p>
      </div>

      {/* Status */}
      <div className="shrink-0">
        <StatusBadge status={asset.status} />
      </div>

      {/* Access Tier */}
      <div className="shrink-0">
        <AccessTierBadge tier={asset.access_tier} />
      </div>

      {/* Resolution */}
      <span className="text-xs font-mono text-zinc-400 tabular-nums w-16 text-right shrink-0 hidden lg:block">
        {asset.resolution || '--'}
      </span>

      {/* Duration */}
      <span className="text-xs text-zinc-400 tabular-nums w-14 text-right shrink-0 hidden md:block">
        {asset.duration_ms ? formatDuration(asset.duration_ms) : '--'}
      </span>

      {/* Storage */}
      <span className="text-xs text-zinc-400 tabular-nums w-16 text-right shrink-0 hidden lg:block">
        {formatBytes(asset.total_storage_bytes)}
      </span>

      {/* Object ID (manifest on Sia) */}
      <span className="text-xs tabular-nums w-24 text-right shrink-0 hidden xl:flex justify-end">
        {asset.manifest_object_id ? (
          <ObjectIdBadge
            value={asset.manifest_object_id}
            truncate={4}
            hideCopy
            className="text-[10px]"
          />
        ) : (
          <span className="text-zinc-600">--</span>
        )}
      </span>

      {/* Created */}
      <span className="text-xs text-zinc-500 w-24 text-right shrink-0 hidden md:block">
        {formatRelativeTime(asset.created_at)}
      </span>

      {/* Actions */}
      {!isSelecting && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-400 hover:text-zinc-200"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = `/studio/assets/${asset.id}`;
            }}
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-red-400/70 hover:text-red-400"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm('Delete this asset?')) {
                deleteAsset.mutate(asset.id);
              }
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden"
        >
          <Skeleton className="aspect-video rounded-none" />
          <div className="p-3.5">
            <Skeleton className="h-4 w-3/4 mb-2" />
            <Skeleton className="h-5 w-1/2 mb-2" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3 border-b border-white/[0.04] last:border-b-0"
        >
          <Skeleton className="w-20 h-[45px] rounded-lg" />
          <div className="flex-1">
            <Skeleton className="h-4 w-40 mb-1" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-md" />
          <Skeleton className="h-5 w-16 rounded-md" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function AssetsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteAsset = useDeleteAsset();

  const view = (searchParams.get('view') as 'grid' | 'list') ?? 'grid';
  const page = Number(searchParams.get('page') ?? '1');
  const statusFilter = searchParams.get('status') ?? 'all';
  const tierFilter = searchParams.get('tier') ?? 'all';
  const sortOrder = searchParams.get('sort') ?? 'newest';
  const searchQuery = searchParams.get('q') ?? '';

  const [searchInput, setSearchInput] = useState(searchQuery);
  const debouncedSearch = useDebounce(searchInput, 300);

  const isSelecting = selectedIds.size > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} selected asset${count !== 1 ? 's' : ''}? This cannot be undone.`))
      return;

    setIsDeleting(true);
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      try {
        await deleteAsset.mutateAsync(id);
      } catch {
        /* continue deleting remaining */
      }
    }
    setSelectedIds(new Set());
    setIsDeleting(false);
  }, [selectedIds, deleteAsset]);

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== 'all' && value !== 'newest' && value !== '') {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      // Reset page when changing filters
      if (key !== 'page' && key !== 'view') {
        next.delete('page');
      }
      return next;
    });
  };

  // Sync debounced search to URL
  const activeSearch = debouncedSearch || undefined;

  const assets = useAssets({
    page,
    limit: 20,
    status: statusFilter !== 'all' ? (statusFilter as VideoAssetStatus) : undefined,
    accessTier: tierFilter !== 'all' ? (tierFilter as AccessTier) : undefined,
    search: activeSearch,
  });

  const totalPages = assets.data ? Math.ceil(assets.data.total / 20) : 0;

  return (
    <PageContainer>
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex items-center justify-between mb-6"
      >
        <div>
          <h1 className="text-2xl font-semibold text-[#f0f0f0] tracking-tight font-heading">
            Video Assets
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {assets.data
              ? `${assets.data.total} asset${assets.data.total !== 1 ? 's' : ''}`
              : 'Loading assets...'}
          </p>
        </div>
        <Button
          asChild
          className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg h-9 px-4"
        >
          <Link to="/studio/upload" className="gap-2">
            <Upload className="w-4 h-4" />
            Upload Video
          </Link>
        </Button>
      </motion.div>

      {/* Toolbar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.05 }}
        className="flex flex-wrap items-center gap-3 mb-6"
      >
        {/* Left side: View toggle + Search */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center rounded-lg bg-white/[0.04] border border-white/[0.08] p-0.5 shrink-0">
            <button
              onClick={() => setParam('view', 'grid')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                view === 'grid'
                  ? 'bg-teal-500/10 text-teal-400'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setParam('view', 'list')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                view === 'list'
                  ? 'bg-teal-500/10 text-teal-400'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Search assets..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                if (!e.target.value) setParam('q', '');
              }}
              className="pl-9 pr-8 h-9"
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput('');
                  setParam('q', '');
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Select all toggle */}
        <div className="shrink-0">
          <Button
            variant={isSelecting ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              if (isSelecting) {
                clearSelection();
              } else if (assets.data) {
                setSelectedIds(new Set(assets.data.data.map((a) => a.id)));
              }
            }}
            className="gap-1.5 h-9"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            {isSelecting ? 'Deselect All' : 'Select All'}
          </Button>
        </div>

        {/* Right side: Filters + Sort */}
        <div className="flex items-center gap-2 shrink-0">
          <Select value={statusFilter} onValueChange={(v) => setParam('status', v)}>
            <SelectTrigger className="w-[120px] h-9 rounded-lg">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="created">Created</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={tierFilter} onValueChange={(v) => setParam('tier', v)}>
            <SelectTrigger className="w-[120px] h-9 rounded-lg">
              <SelectValue placeholder="Access" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Access</SelectItem>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="private">Private</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortOrder} onValueChange={(v) => setParam('sort', v)}>
            <SelectTrigger className="w-[110px] h-9 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="title">Title A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </motion.div>

      {/* Content */}
      {assets.isLoading ? (
        view === 'grid' ? (
          <GridSkeleton />
        ) : (
          <ListSkeleton />
        )
      ) : assets.data && assets.data.data.length > 0 ? (
        <>
          {view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {assets.data.data.map((asset) => (
                <VideoCard
                  key={asset.id}
                  asset={asset}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(asset.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
              {/* List header */}
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.08] text-[11px] font-medium text-zinc-500 uppercase tracking-wider bg-white/[0.01]">
                {isSelecting && <span className="shrink-0 w-4" />}
                <span className="w-20 shrink-0" />
                <span className="flex-1">Title</span>
                <span className="shrink-0 w-16">Status</span>
                <span className="shrink-0 w-16">Access</span>
                <span className="shrink-0 w-16 text-right hidden lg:block">Resolution</span>
                <span className="shrink-0 w-14 text-right hidden md:block">Duration</span>
                <span className="shrink-0 w-16 text-right hidden lg:block">Storage</span>
                <span className="shrink-0 w-20 text-right hidden xl:block">Object ID</span>
                <span className="shrink-0 w-24 text-right hidden md:block">Created</span>
                {!isSelecting && <span className="shrink-0 w-16" />}
              </div>
              <div className="divide-y divide-white/[0.04]">
                {assets.data.data.map((asset) => (
                  <AssetListRow
                    key={asset.id}
                    asset={asset}
                    isSelecting={isSelecting}
                    isSelected={selectedIds.has(asset.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-2">
              <span className="text-xs text-zinc-500 tabular-nums">
                Page {page} of {totalPages} ({assets.data.total} assets)
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setParam('page', String(page - 1))}
                  className="bg-white/[0.04] hover:bg-white/[0.08]"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setParam('page', String(page + 1))}
                  className="bg-white/[0.04] hover:bg-white/[0.08]"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Empty State */
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl">
          <div className="p-16 text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center mb-4">
              <Film className="w-6 h-6 text-zinc-500" />
            </div>
            <h3 className="text-base font-medium text-zinc-200 font-heading mb-1">No videos yet</h3>
            <p className="text-sm text-zinc-400 mb-4">Get started by uploading your first video</p>
            <Button
              asChild
              className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg"
            >
              <Link to="/studio/upload" className="gap-2">
                <Upload className="w-4 h-4" />
                Upload your first video
              </Link>
            </Button>
          </div>
        </div>
      )}
      {/* Floating action bar for bulk actions */}
      <AnimatePresence>
        {isSelecting && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-zinc-900/90 border border-white/[0.1] backdrop-blur-xl shadow-2xl shadow-black/40">
              <span className="text-sm font-medium text-zinc-200">{selectedIds.size} selected</span>
              <div className="w-px h-5 bg-white/[0.1]" />
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={isDeleting}
                className="gap-1.5"
              >
                {isDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageContainer>
  );
}
