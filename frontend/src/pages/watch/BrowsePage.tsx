import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Play,
  Film,
  Search,
  Lock,
  Upload,
  Loader2,
  HardDrive,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAssets, type VideoAsset } from '@/hooks/useAssets';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDuration, formatRelativeTime, formatAddress } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import { siaObjectUrl } from '@/lib/sia';

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type AccessFilter = 'all' | 'free' | 'premium';
type SortOrder = 'latest' | 'oldest' | 'title-asc' | 'title-desc';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VideoGridCard({ asset }: { asset: VideoAsset }) {
  const navigate = useNavigate();
  const isPremium = asset.access_tier !== 'public';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15 }}
      role="button"
      tabIndex={0}
      aria-label={asset.title}
      className="group cursor-pointer rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.12] hover:shadow-lg hover:shadow-[0_0_30px_rgba(20,184,166,0.05)] transition-all duration-200"
      onClick={() => navigate(`/watch/${asset.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/watch/${asset.id}`);
        }
      }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-zinc-900 overflow-hidden">
        {asset.thumbnail_object_ids?.[0] ? (
          <img
            src={siaObjectUrl(asset.thumbnail_object_ids[0])}
            alt={asset.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
            <Film className="w-8 h-8 text-zinc-600" />
          </div>
        )}

        {/* Duration badge */}
        {asset.duration_ms > 0 && (
          <span className="absolute bottom-2 right-2 bg-black/80 text-white text-[11px] font-mono px-1.5 py-0.5 rounded-md">
            {formatDuration(asset.duration_ms)}
          </span>
        )}

        {/* Premium indicator */}
        {isPremium && (
          <div className="absolute top-2 left-2">
            <span className="inline-flex items-center gap-1 bg-black/70 backdrop-blur-sm text-amber-400 text-[10px] font-medium px-2 py-0.5 rounded-full">
              <Lock className="w-2.5 h-2.5" />
              Premium
            </span>
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play className="w-5 h-5 text-zinc-900 ml-0.5" fill="currentColor" />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="text-sm font-medium text-zinc-200 line-clamp-2 mb-1.5 leading-snug">
          {asset.title}
        </h3>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 truncate font-mono">
            {formatAddress(asset.creator_address)}
          </span>
          <span className="text-[11px] text-zinc-600 shrink-0 ml-2">
            {formatRelativeTime(asset.created_at)}
          </span>
        </div>
        {asset.manifest_object_id && (
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-400/70">
              <HardDrive className="w-2.5 h-2.5" />
              Sia
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function VideoGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.08]">
          <Skeleton className="aspect-video" />
          <div className="p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function BrowsePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const [accessFilter, setAccessFilter] = useState<AccessFilter>(
    (searchParams.get('access') as AccessFilter) ?? 'all',
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    (searchParams.get('sort') as SortOrder) ?? 'latest',
  );
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(searchQuery, 400);
  const isDebouncing = searchQuery !== debouncedSearch;

  const accessTierParam = useMemo(() => {
    if (accessFilter === 'free') return 'public' as const;
    return undefined;
  }, [accessFilter]);

  const assetsQuery = useAssets({
    status: 'ready',
    page,
    limit: 20,
    search: debouncedSearch || undefined,
    accessTier: accessTierParam,
  });

  const filteredAssets = useMemo(() => {
    let assets = assetsQuery.data?.data ?? [];

    if (accessFilter === 'premium') {
      assets = assets.filter((a) => a.access_tier !== 'public');
    }

    if (sortOrder === 'oldest') {
      assets = [...assets].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    } else if (sortOrder === 'title-asc') {
      assets = [...assets].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      );
    } else if (sortOrder === 'title-desc') {
      assets = [...assets].sort((a, b) =>
        b.title.localeCompare(a.title, undefined, { sensitivity: 'base' }),
      );
    }

    return assets;
  }, [assetsQuery.data, accessFilter, sortOrder]);

  const totalPages = assetsQuery.data
    ? Math.ceil(assetsQuery.data.total / 20)
    : 1;

  const updateParams = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value && value !== 'all' && value !== 'latest') {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <PageContainer className="max-w-full px-4 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#f0f0f0] font-heading">Browse Videos</h1>
          <p className="text-sm text-zinc-400 mt-0.5">Discover decentralized video content on SiaStream</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-6">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          {isDebouncing ? (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 animate-spin" />
          ) : (
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          )}
          <Input
            aria-label="Search videos"
            placeholder="Search videos..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
              updateParams('q', e.target.value);
            }}
            className="pl-9 bg-white/[0.03] border-white/[0.08] focus:border-white/[0.15]"
          />
        </div>

        {/* Access filter pills */}
        <div className="flex items-center gap-1 bg-white/[0.03] rounded-full p-1 border border-white/[0.08]">
          {(['all', 'free', 'premium'] as const).map((f) => (
            <button
              key={f}
              onClick={() => {
                setAccessFilter(f);
                setPage(1);
                updateParams('access', f);
              }}
              className={cn(
                'px-3.5 py-1 text-[13px] font-medium rounded-full transition-all duration-150',
                accessFilter === f
                  ? 'bg-white/[0.07] text-zinc-100 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {f === 'all' ? 'All' : f === 'free' ? 'Free' : 'Premium'}
            </button>
          ))}
        </div>

        {/* Sort */}
        <Select
          value={sortOrder}
          onValueChange={(v: SortOrder) => {
            setSortOrder(v);
            updateParams('sort', v);
          }}
        >
          <SelectTrigger className="w-[140px] bg-white/[0.03] border-white/[0.08]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Latest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="title-asc">Title A-Z</SelectItem>
            <SelectItem value="title-desc">Title Z-A</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Video Grid */}
      {assetsQuery.isLoading ? (
        <VideoGridSkeleton />
      ) : assetsQuery.isError ? (
        <EmptyState
          icon={Film}
          title="Failed to load videos"
          description={assetsQuery.error?.message ?? 'Something went wrong'}
          action={{ label: 'Try again', onClick: () => assetsQuery.refetch() }}
        />
      ) : filteredAssets.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No videos found"
          description={
            debouncedSearch
              ? `No results for "${debouncedSearch}"`
              : 'No videos available yet'
          }
          action={{ label: 'Upload a video', onClick: () => navigate('/watch/upload') }}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAssets.map((asset) => (
              <VideoGridCard key={asset.id} asset={asset} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-8 pb-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="bg-white/[0.03] border-white/[0.08]"
                aria-label="Previous page"
              >
                Previous
              </Button>
              <span className="text-xs text-zinc-500">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="bg-white/[0.03] border-white/[0.08]"
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
