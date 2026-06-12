import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Lock,
  Film,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Ticket,
  Shield,
  Database,
  Clock,
  Monitor,
  HardDrive,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { EmptyState } from '@/components/shared/EmptyState';
import { VideoPlayer } from '@/components/shared/VideoPlayer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAsset, useAssets, type VideoAsset } from '@/hooks/useAssets';
import { usePlayback } from '@/hooks/usePlayback';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import { useVideoAccess } from '@/hooks/useVideoAccess';
import {
  formatDuration,
  formatRelativeTime,
  formatAddress,
  formatBytes,
} from '@/lib/formatters';
import { truncateAddress } from '@/lib/address-helpers';
import { cn } from '@/lib/cn';
import { siaObjectUrl } from '@/lib/sia';

// ---------------------------------------------------------------------------
// CopyButton (inline)
// ---------------------------------------------------------------------------

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      className="p-1 rounded-md hover:bg-white/[0.05] text-zinc-500 hover:text-zinc-300 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Access Gate - Glassmorphism redesign
// ---------------------------------------------------------------------------

function AccessGate({
  asset,
  onAccessGranted,
}: {
  asset: VideoAsset;
  onAccessGranted: () => void;
}) {
  const { isConnected, address } = useWalletAuth();
  const { hasAccess, isChecking, checkAccess, error } = useVideoAccess();
  const [checking, setChecking] = useState(false);
  const [denied, setDenied] = useState(false);

  const handleVerify = useCallback(async () => {
    if (!address) return;
    setChecking(true);
    setDenied(false);
    const granted = await checkAccess({
      assetId: asset.id,
      walletAddress: address,
      accessTier: asset.access_tier,
    });
    setChecking(false);
    if (granted) {
      onAccessGranted();
    } else {
      setDenied(true);
    }
  }, [address, asset.id, asset.access_tier, checkAccess, onAccessGranted]);

  useEffect(() => {
    if (isConnected && address && !hasAccess && !isChecking) {
      handleVerify();
    }
  }, [isConnected, address]);

  const tierIcon =
    asset.access_tier === 'private'
      ? Lock
      : asset.access_tier === 'pay_per_view'
        ? Ticket
        : Shield;

  const TierIcon = tierIcon;

  const getDeniedMessage = () => {
    switch (asset.access_tier) {
      case 'private':
        return 'Your wallet is not on the allowlist for this video. Contact the creator to request access.';
      case 'pay_per_view':
        return 'You need a viewing ticket to watch this video. Purchase one to continue.';
      case 'subscription':
        return 'You need an active subscription pass to access this content.';
      default:
        return 'You do not have permission to view this content.';
    }
  };

  const getTierLabel = () => {
    switch (asset.access_tier) {
      case 'private': return 'Private';
      case 'pay_per_view': return 'Pay-per-View';
      case 'subscription': return 'Subscription';
      default: return 'Restricted';
    }
  };

  return (
    <div className="absolute inset-0 bg-black/60 backdrop-blur-2xl flex items-center justify-center z-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="bg-black/60 backdrop-blur-2xl border border-white/[0.08] rounded-2xl p-8 max-w-sm text-center shadow-2xl shadow-black/60"
      >
        {denied && !checking ? (
          <>
            {/* Denied state */}
            <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 mb-5">
              <div className="absolute inset-0 rounded-full bg-red-500/15 blur-xl" />
              <AlertCircle className="relative w-7 h-7 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-50 mb-1.5">
              Access Denied
            </h3>
            <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
              {getDeniedMessage()}
            </p>
            {address && (
              <div className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2 mb-5">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Your wallet</p>
                <p className="text-xs font-mono text-zinc-400 truncate">{address}</p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleVerify}
                variant="outline"
                className="w-full gap-2"
              >
                <Shield className="w-3.5 h-3.5" />
                Check Again
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Default / checking state */}
            <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-full bg-violet-500/10 mb-5">
              <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-xl" />
              {checking || isChecking ? (
                <Loader2 className="relative w-7 h-7 text-violet-400 animate-spin" />
              ) : (
                <TierIcon className="relative w-7 h-7 text-violet-400" />
              )}
            </div>

            <h3 className="text-lg font-semibold text-zinc-50 mb-1.5">
              {checking || isChecking ? 'Verifying access...' : 'This content requires access'}
            </h3>
            {!(checking || isChecking) && (
              <>
                <p className="text-sm text-zinc-400 mb-3 leading-relaxed">
                  {asset.access_tier === 'private'
                    ? 'Only allowlisted addresses can watch this video'
                    : asset.access_tier === 'pay_per_view'
                      ? 'Purchase a viewing ticket to watch this video'
                      : 'Hold a SubscriptionPass to watch this content'}
                </p>
                <span className="inline-flex items-center bg-white/[0.05] rounded-full px-3 py-1 text-xs text-zinc-400 mb-6">
                  {getTierLabel()}
                </span>
              </>
            )}
            {checking || isChecking ? (
              <p className="text-xs text-zinc-500 mt-2">Checking on-chain data...</p>
            ) : error ? (
              <div className="mt-1">
                <p className="text-xs text-red-400 mb-3">{error}</p>
                <Button variant="outline" size="sm" onClick={handleVerify}>
                  Retry
                </Button>
              </div>
            ) : !isConnected ? (
              <div className="mt-1">
                <p className="text-xs text-zinc-500">Authentication required</p>
              </div>
            ) : (
              <div className="mt-1">
                <Button
                  onClick={handleVerify}
                  className="w-full bg-violet-600 hover:bg-violet-500 text-white border-0"
                >
                  Verify Access
                </Button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processing card
// ---------------------------------------------------------------------------

function ProcessingCard({ asset }: { asset: VideoAsset }) {
  return (
    <div className="w-full max-h-[70vh] aspect-video bg-zinc-900/80 flex items-center justify-center">
      <div className="text-center p-8">
        <Loader2 className="w-10 h-10 text-amber-400 animate-spin mx-auto mb-4" />
        <h3 className="text-lg font-medium text-zinc-50 mb-1">
          Video is still processing
        </h3>
        <p className="text-sm text-zinc-500">
          This video is being transcoded and will be available shortly.
        </p>
        <Badge variant="warning" className="mt-3">
          {asset.status}
        </Badge>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Related video card
// ---------------------------------------------------------------------------

function RelatedCard({ asset }: { asset: VideoAsset }) {
  const navigate = useNavigate();

  return (
    <div
      role="article"
      className="cursor-pointer group rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.12] hover:shadow-lg hover:shadow-[0_0_30px_rgba(20,184,166,0.05)] transition-all duration-200"
      onClick={() => navigate(`/watch/${asset.id}`)}
    >
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
            <Film className="w-6 h-6 text-zinc-600" />
          </div>
        )}
        {asset.duration_ms > 0 && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded-md">
            {formatDuration(asset.duration_ms)}
          </span>
        )}
        {/* Hover play overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play className="w-4 h-4 text-zinc-900 ml-0.5" fill="currentColor" />
          </div>
        </div>
      </div>
      <div className="p-2.5">
        <h4 className="text-xs font-medium text-zinc-200 line-clamp-2 leading-relaxed">
          {asset.title}
        </h4>
        <span className="text-[11px] text-zinc-500 mt-1 block">
          {formatRelativeTime(asset.created_at)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blockchain info item
// ---------------------------------------------------------------------------

function ChainItem({
  icon: Icon,
  label,
  value,
  copyValue,
  explorerUrl,
  accent = 'text-zinc-400',
  accentBg = 'bg-white/[0.05]',
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  copyValue?: string;
  explorerUrl?: string;
  accent?: string;
  accentBg?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group">
      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5', accentBg)}>
        <Icon className={cn('w-3.5 h-3.5', accent)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-0.5">{label}</p>
        <div className="flex items-center gap-1">
          <span className="text-xs font-mono text-zinc-300 truncate">{value}</span>
          {copyValue && <CopyBtn text={copyValue} />}
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-0.5 rounded-md hover:bg-white/[0.05] text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address: walletAddress } = useWalletAuth();

  const { data: asset, isLoading, isError, error, refetch } = useAsset(id);
  const { data: playback, isLoading: playbackLoading } = usePlayback(id);
  const relatedQuery = useAssets({ status: 'ready', limit: 5 });

  const [accessGranted, setAccessGranted] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [blockchainOpen, setBlockchainOpen] = useState(true);

  // A video is gated only if it has a non-public access tier.
  const isGated = asset && asset.access_tier !== 'public';
  const canPlay = !isGated || accessGranted;
  const isReady = asset?.status === 'ready';

  const relatedAssets = (relatedQuery.data?.data ?? []).filter(
    (a) => a.id !== id,
  ).slice(0, 4);

  // Loading state
  if (isLoading) {
    return (
      <PageContainer className="max-w-full px-0 sm:px-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <Skeleton className="w-full aspect-video rounded-xl mb-6" />
          <div className="space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </PageContainer>
    );
  }

  // Error state
  if (isError || !asset) {
    return (
      <PageContainer className="max-w-full px-4 sm:px-6">
        <EmptyState
          icon={AlertCircle}
          title="Video not found"
          description={error?.message ?? 'This video could not be loaded.'}
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      </PageContainer>
    );
  }

  const accessTierLabel =
    asset.access_tier === 'public'
      ? 'Free'
      : asset.access_tier === 'private'
        ? 'Private'
        : asset.access_tier === 'pay_per_view'
          ? 'Pay-per-View'
          : 'Subscription';

  return (
    <PageContainer className="max-w-full px-0 sm:px-0 py-4">
      {/* Video Player - premium wrapper */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="relative rounded-xl shadow-2xl shadow-black/40 overflow-hidden mb-6">
          {!isReady ? (
            <ProcessingCard asset={asset} />
          ) : (
            <>
              <VideoPlayer
                src={canPlay ? (playback?.playback_url ?? '') : ''}
                poster={playback?.poster_url ?? undefined}
                className="rounded-none border-0"
              />
              {isGated && !accessGranted && (
                <AccessGate
                  asset={asset}
                  onAccessGranted={() => setAccessGranted(true)}
                />
              )}
            </>
          )}
        </div>

        {/* Video Info - clean layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          {/* Left column */}
          <div>
            {/* Title */}
            <h1 className="text-2xl font-bold text-[#f0f0f0] font-heading mb-3 leading-tight">
              {asset.title}
            </h1>

            {/* Creator row */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {(asset.creator_address || '').slice(2, 4).toUpperCase()}
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Creator</span>
                  <span className="text-sm text-zinc-300 font-mono truncate">
                    {truncateAddress(asset.creator_address)}
                  </span>
                  <CopyBtn text={asset.creator_address} />
                </div>
                {asset.manifest_object_id && (
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 bg-violet-500/10 border border-violet-500/20 rounded-full px-2 py-0.5 text-[10px] text-violet-400 font-medium">
                      <HardDrive className="w-2.5 h-2.5" />
                      Sia
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Stats pills row */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {asset.resolution && (
                <span className="inline-flex items-center gap-1.5 bg-white/[0.05] rounded-full px-3 py-1 text-xs text-zinc-400">
                  <Monitor className="w-3 h-3" />
                  {asset.resolution}
                </span>
              )}
              {asset.duration_ms > 0 && (
                <span className="inline-flex items-center gap-1.5 bg-white/[0.05] rounded-full px-3 py-1 text-xs text-zinc-400">
                  <Clock className="w-3 h-3" />
                  {formatDuration(asset.duration_ms)}
                </span>
              )}
              <Badge
                variant={asset.access_tier === 'public' ? 'success' : 'warning'}
                className="rounded-full"
              >
                {asset.access_tier !== 'public' && (
                  <Lock className="w-3 h-3 mr-1" />
                )}
                {accessTierLabel}
              </Badge>
              <span className="text-xs text-zinc-500">
                {formatRelativeTime(asset.created_at)}
              </span>
            </div>

            {/* Description - expandable */}
            {asset.description && (
              <div className="mb-6 bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
                <p
                  className={cn(
                    'text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed',
                    !showDescription && 'line-clamp-3',
                  )}
                >
                  {asset.description}
                </p>
                {asset.description.length > 200 && (
                  <button
                    onClick={() => setShowDescription(!showDescription)}
                    aria-expanded={showDescription}
                    className="text-xs text-teal-400 hover:text-teal-300 mt-2 flex items-center gap-0.5 transition-colors"
                  >
                    {showDescription ? (
                      <>
                        Show less <ChevronUp className="w-3 h-3" />
                      </>
                    ) : (
                      <>
                        Show more <ChevronDown className="w-3 h-3" />
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Right column: Blockchain & Storage */}
          <div className="space-y-4">
            {/* On-chain identity */}
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
              <button
                onClick={() => setBlockchainOpen(!blockchainOpen)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-teal-400" />
                  <span className="text-sm font-medium text-zinc-200">Storage Data</span>
                </div>
                <motion.div
                  animate={{ rotate: blockchainOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-4 h-4 text-zinc-500" />
                </motion.div>
              </button>
              <AnimatePresence>
                {blockchainOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-2 pb-3 space-y-0.5">
                      {asset.manifest_object_id && (
                        <ChainItem
                          icon={HardDrive}
                          label="Manifest Object"
                          value={truncateAddress(asset.manifest_object_id, 8, 6)}
                          copyValue={asset.manifest_object_id}
                          accent="text-violet-400"
                          accentBg="bg-violet-500/10"
                        />
                      )}
                      {asset.manifest_object_id && (
                        <ChainItem
                          icon={ExternalLink}
                          label="Raw Manifest"
                          value={truncateAddress(siaObjectUrl(asset.manifest_object_id), 20, 6)}
                          copyValue={siaObjectUrl(asset.manifest_object_id)}
                          explorerUrl={siaObjectUrl(asset.manifest_object_id)}
                          accent="text-zinc-400"
                          accentBg="bg-white/[0.05]"
                        />
                      )}
                    </div>

                    {/* Storage stats grid */}
                    {(asset.segment_count > 0 || asset.total_storage_bytes > 0 || (asset.thumbnail_object_ids && asset.thumbnail_object_ids.length > 0)) && (
                      <div className="border-t border-white/[0.06] mx-4 pt-3 pb-3">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2.5 px-0.5">Sia Storage</p>
                        <div className="grid grid-cols-3 gap-2">
                          {asset.segment_count > 0 && (
                            <div className="text-center rounded-lg bg-white/[0.03] border border-white/[0.06] py-2.5 px-2">
                              <p className="text-base font-semibold text-zinc-200">{asset.segment_count}</p>
                              <p className="text-[10px] text-zinc-500">Segments</p>
                            </div>
                          )}
                          {asset.total_storage_bytes > 0 && (
                            <div className="text-center rounded-lg bg-white/[0.03] border border-white/[0.06] py-2.5 px-2">
                              <p className="text-base font-semibold text-zinc-200">{formatBytes(asset.total_storage_bytes)}</p>
                              <p className="text-[10px] text-zinc-500">Storage</p>
                            </div>
                          )}
                          {asset.thumbnail_object_ids && asset.thumbnail_object_ids.length > 0 && (
                            <div className="text-center rounded-lg bg-white/[0.03] border border-white/[0.06] py-2.5 px-2">
                              <p className="text-base font-semibold text-zinc-200">{asset.thumbnail_object_ids.length}</p>
                              <p className="text-[10px] text-zinc-500">Thumbnails</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Related Videos */}
        {relatedAssets.length > 0 && (
          <div className="mt-10 pb-4">
            <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-4">
              More Videos
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {relatedAssets.map((a) => (
                <RelatedCard key={a.id} asset={a} />
              ))}
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
