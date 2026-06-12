import { useState, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Film,
  Lock,
  Upload,
  Play,
  Pencil,
  Trash2,
  Copy,
  Check,
  Database,
  HardDrive,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Wallet,
} from 'lucide-react';
// ConnectButton removed (Sia wallet integration removed)
import { PageContainer } from '@/components/layout/PageContainer';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  useAssets,
  useUpdateAsset,
  useDeleteAsset,
  type VideoAsset,
  type VideoAssetStatus,
} from '@/hooks/useAssets';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import {
  formatDuration,
  formatRelativeTime,
  formatBytes,
} from '@/lib/formatters';
import { cn } from '@/lib/cn';
import { siaObjectUrl } from '@/lib/sia';

// ---------------------------------------------------------------------------
// Wallet gate - glassmorphism
// ---------------------------------------------------------------------------

function WalletGate() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-md w-full bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 text-center shadow-2xl shadow-black/20"
      >
        <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-full bg-violet-500/10 mb-5">
          <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-xl" />
          <Wallet className="relative w-7 h-7 text-violet-400" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-50 mb-1.5">
          Connect Wallet
        </h2>
        <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
          Connect your wallet to view and manage your uploaded videos.
        </p>
        <p className="text-xs text-zinc-500">Wallet connection not available</p>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card with gradient accent
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  accentColor,
  iconBg,
}: {
  icon: typeof Film;
  label: string;
  value: string | number;
  accentColor: string;
  iconBg: string;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3 hover:border-white/[0.12] transition-colors">
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
          iconBg,
        )}
      >
        <Icon className={cn('w-5 h-5', accentColor)} />
      </div>
      <div>
        <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</p>
        <p className="text-lg font-semibold text-zinc-100">{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: VideoAssetStatus }) {
  const config: Record<
    VideoAssetStatus,
    { variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'default'; label: string }
  > = {
    created: { variant: 'secondary', label: 'Created' },
    uploading: { variant: 'warning', label: 'Uploading' },
    processing: { variant: 'warning', label: 'Processing' },
    ready: { variant: 'success', label: 'Ready' },
    failed: { variant: 'destructive', label: 'Failed' },
  };
  const { variant, label } = config[status] ?? config.created;
  return <Badge variant={variant} className="rounded-full text-[10px]">{label}</Badge>;
}

// ---------------------------------------------------------------------------
// Video card with management overlay
// ---------------------------------------------------------------------------

function LibraryVideoCard({
  asset,
  onDelete,
}: {
  asset: VideoAsset;
  onDelete: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(asset.title);
  const updateAsset = useUpdateAsset();

  const handleCopyEmbed = useCallback(() => {
    const embed = `<iframe src="${window.location.origin}/embed/${asset.id}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(embed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [asset.id]);

  const handleSaveTitle = useCallback(() => {
    if (titleValue.trim() && titleValue !== asset.title) {
      updateAsset.mutate({ id: asset.id, data: { title: titleValue.trim() } });
    }
    setEditTitle(false);
  }, [titleValue, asset.id, asset.title, updateAsset]);

  const isPremium = asset.access_tier !== 'public';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      role="article"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          navigate(`/watch/${asset.id}`);
        }
      }}
      className="group relative rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.12] hover:shadow-lg hover:shadow-[0_0_30px_rgba(20,184,166,0.05)] transition-all duration-200"
    >
      {/* Thumbnail */}
      <div
        className="relative aspect-video bg-zinc-900 cursor-pointer overflow-hidden"
        onClick={() => navigate(`/watch/${asset.id}`)}
      >
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

        {/* Status badge for non-ready */}
        {asset.status !== 'ready' && (
          <div className="absolute top-2 left-2">
            <StatusBadge status={asset.status} />
          </div>
        )}

        {/* Management overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 group-focus-within:bg-black/40 transition-colors duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center hover:bg-white transition-colors shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/watch/${asset.id}`);
            }}
            title="Play"
          >
            <Play className="w-4 h-4 text-zinc-900 ml-0.5" fill="currentColor" />
          </button>
          <button
            className="w-9 h-9 rounded-full bg-zinc-800/90 text-zinc-300 flex items-center justify-center hover:bg-zinc-700 transition-colors shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              setEditTitle(true);
            }}
            title="Edit title"
            aria-label="Edit title"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            className="w-9 h-9 rounded-full bg-zinc-800/90 text-zinc-300 flex items-center justify-center hover:bg-zinc-700 transition-colors shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              handleCopyEmbed();
            }}
            title={copied ? 'Copied!' : 'Copy embed code'}
            aria-label="Copy embed code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            className="w-9 h-9 rounded-full bg-red-900/80 text-red-300 flex items-center justify-center hover:bg-red-800 transition-colors shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(asset.id);
            }}
            title="Delete"
            aria-label="Delete video"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        {editTitle ? (
          <div className="flex items-center gap-1">
            <Input
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              className="h-7 text-xs bg-white/[0.03] border-white/[0.08]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') setEditTitle(false);
              }}
            />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSaveTitle}>
              Save
            </Button>
          </div>
        ) : (
          <h3 className="text-sm font-medium text-zinc-200 line-clamp-1">
            {asset.title}
          </h3>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1.5">
            <StatusBadge status={asset.status} />
            {isPremium && (
              <Badge variant="warning" className="text-[10px] gap-0.5 rounded-full">
                <Lock className="w-2.5 h-2.5" />
                {asset.access_tier === 'private'
                  ? 'Private'
                  : asset.access_tier === 'pay_per_view'
                    ? 'PPV'
                    : 'Sub'}
              </Badge>
            )}
          </div>
          <span className="text-[11px] text-zinc-600">
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function MyLibraryPage() {
  const { isConnected, address } = useWalletAuth();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const assetsQuery = useAssets({
    creatorAddress: address ?? undefined,
    status: statusFilter === 'all' ? undefined : (statusFilter as VideoAssetStatus),
    page,
    limit: PAGE_SIZE,
  });

  const deleteAsset = useDeleteAsset();

  const assets = assetsQuery.data?.data ?? [];
  const totalPages = assetsQuery.data
    ? Math.ceil(assetsQuery.data.total / PAGE_SIZE)
    : 1;

  const counts = useMemo(() => {
    const all = assetsQuery.data?.data ?? [];
    return {
      all: all.length,
      processing: all.filter((a) => a.status === 'processing').length,
      ready: all.filter((a) => a.status === 'ready').length,
      failed: all.filter((a) => a.status === 'failed').length,
    };
  }, [assetsQuery.data]);

  const totalStorage = useMemo(
    () => assets.reduce((sum, a) => sum + (a.total_storage_bytes ?? 0), 0),
    [assets],
  );
  const readyCount = useMemo(
    () => assets.filter((a) => a.status === 'ready').length,
    [assets],
  );
  const storedCount = useMemo(
    () => assets.filter((a) => !!a.manifest_object_id).length,
    [assets],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteAsset.mutateAsync(deleteTarget);
    setDeleteTarget(null);
  }, [deleteTarget, deleteAsset]);

  if (!isConnected) {
    return (
      <PageContainer>
        <WalletGate />
      </PageContainer>
    );
  }

  const STATUS_TABS = [
    { key: 'all', label: 'All', count: counts.all, variant: 'secondary' as const },
    { key: 'processing', label: 'Processing', count: counts.processing, variant: 'warning' as const },
    { key: 'ready', label: 'Ready', count: counts.ready, variant: 'success' as const },
    { key: 'failed', label: 'Failed', count: counts.failed, variant: 'destructive' as const },
  ];

  return (
    <PageContainer>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#f0f0f0] font-heading mb-1">My Library</h1>
          <p className="text-sm text-zinc-400">Your uploaded videos and their on-chain status</p>
        </div>
        <Button
          size="sm"
          onClick={() => navigate('/watch/upload')}
          className="gap-1.5"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={Film}
          label="Total Videos"
          value={assetsQuery.isLoading ? '...' : assets.length}
          accentColor="text-teal-400"
          iconBg="bg-teal-500/10"
        />
        <StatCard
          icon={HardDrive}
          label="Storage"
          value={assetsQuery.isLoading ? '...' : formatBytes(totalStorage)}
          accentColor="text-violet-400"
          iconBg="bg-violet-500/10"
        />
        <StatCard
          icon={CheckCircle2}
          label="Ready"
          value={assetsQuery.isLoading ? '...' : readyCount}
          accentColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
        />
        <StatCard
          icon={HardDrive}
          label="Stored"
          value={assetsQuery.isLoading ? '...' : storedCount}
          accentColor="text-teal-400"
          iconBg="bg-teal-500/10"
        />
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-1.5 mb-6 bg-white/[0.03] rounded-xl p-1 border border-white/[0.08] w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setStatusFilter(tab.key); setPage(1); }}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150',
              statusFilter === tab.key
                ? 'bg-white/[0.07] text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {tab.label}
            <span
              className={cn(
                'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-medium px-1',
                statusFilter === tab.key
                  ? 'bg-white/[0.1] text-zinc-300'
                  : 'bg-white/[0.05] text-zinc-500',
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Video grid */}
      {assetsQuery.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.08]">
              <Skeleton className="aspect-video" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : assetsQuery.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load library"
          description={assetsQuery.error?.message ?? 'Something went wrong'}
          action={{ label: 'Try again', onClick: () => assetsQuery.refetch() }}
        />
      ) : assets.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No videos yet"
          description="Upload your first video to get started."
          action={{ label: 'Upload your first video', onClick: () => navigate('/watch/upload') }}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets.map((asset) => (
              <LibraryVideoCard
                key={asset.id}
                asset={asset}
                onDelete={setDeleteTarget}
              />
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
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Video</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this video? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300">
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteAsset.isPending}
              className="gap-1.5"
            >
              {deleteAsset.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </motion.div>
    </PageContainer>
  );
}
