import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Play,
  Film,
  Copy,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  X,
  Trash2,
  ExternalLink,
  AlertCircle,
  Clock,
  HardDrive,
  Layers,
  Database,
  RefreshCw,
  Shield,
  ArrowLeft,
  Image,
  Cpu,
  Timer,
  Server,
  Boxes,
  Network,
  FileSignature,
  Wallet,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  useAsset,
  useUpdateAsset,
  useDeleteAsset,
  useAssetSiaInfo,
  type AssetSiaInfo,
  type SiaVariantInfo,
} from '@/hooks/useAssets';
import { usePlayback } from '@/hooks/usePlayback';
import { useProcessingJob, type ProcessingLog } from '@/hooks/useProcessingJob';
import { formatDuration, formatBytes, formatRelativeTime } from '@/lib/formatters';
import { truncateAddress } from '@/lib/address-helpers';
import { siaObjectUrl } from '@/lib/sia';
import { BASE_URL } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { ObjectIdBadge } from '@/components/shared/ObjectIdBadge';
import {
  EXPLORER_LABEL,
  EXTERNAL_LINK_PROPS,
  explorerUrls,
} from '@/lib/sia-explorer';

// ---------------------------------------------------------------------------
// CopyButton (inline)
// ---------------------------------------------------------------------------

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={cn(
        'p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors',
        className,
      )}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline shared badges
// ---------------------------------------------------------------------------

function StatusBadge({ status, large }: { status: string; large?: boolean }) {
  const config: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
    created: { label: 'Created', variant: 'secondary' },
    uploading: { label: 'Uploading', variant: 'warning' },
    processing: { label: 'Processing', variant: 'warning' },
    ready: { label: 'Ready', variant: 'success' },
    failed: { label: 'Failed', variant: 'destructive' },
  };
  const c = config[status] ?? { label: status, variant: 'secondary' as const };
  return (
    <Badge variant={c.variant} className={large ? 'text-sm px-3 py-1' : ''}>
      {c.label}
    </Badge>
  );
}

function AccessTierBadge({ tier, large }: { tier: string; large?: boolean }) {
  const config: Record<string, { label: string; variant: 'default' | 'secondary' | 'warning' | 'success' }> = {
    public: { label: 'Public', variant: 'success' },
    private: { label: 'Private', variant: 'default' },
  };
  const c = config[tier] ?? { label: tier, variant: 'secondary' as const };
  return (
    <Badge variant={c.variant} className={large ? 'text-sm px-3 py-1' : ''}>
      {c.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Inline Editable Field
// ---------------------------------------------------------------------------

function InlineEditable({
  value,
  onSave,
  isSaving,
  as = 'input',
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  isSaving?: boolean;
  as?: 'input' | 'textarea';
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    if (draft.trim() && draft !== value) {
      onSave(draft.trim());
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-start gap-2">
        {as === 'textarea' ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCancel();
            }}
            className="min-h-[60px]"
            autoFocus
          />
        ) : (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') handleCancel();
            }}
            autoFocus
          />
        )}
        <Button size="sm" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className={cn(
        'group cursor-pointer rounded-lg px-2 py-1 -mx-2 -my-1 hover:bg-white/[0.05] transition-colors',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1">{value || <span className="text-zinc-600 italic">Click to edit</span>}</span>
        <Pencil className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processing Pipeline
// ---------------------------------------------------------------------------

const PIPELINE_STEPS = ['Created', 'Uploading', 'Processing', 'Ready'];

function PipelineStepper({ status }: { status: string }) {
  const statusToIndex: Record<string, number> = {
    created: 0,
    uploading: 1,
    processing: 2,
    ready: 3,
    failed: -1,
  };
  const currentIndex = statusToIndex[status] ?? 0;

  return (
    <div className="flex items-center" role="progressbar">
      {PIPELINE_STEPS.map((step, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold',
                  isComplete && 'bg-emerald-500/20 text-emerald-400',
                  isCurrent && status !== 'failed' && 'bg-teal-500/20 text-teal-400',
                  isCurrent && status === 'failed' && 'bg-red-500/20 text-red-400',
                  !isComplete && !isCurrent && 'bg-white/[0.04] text-zinc-500',
                )}
              >
                {isComplete ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : isCurrent && status !== 'failed' && status !== 'ready' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={cn(
                  'text-xs font-medium whitespace-nowrap',
                  isComplete && 'text-emerald-400',
                  isCurrent && 'text-teal-400',
                  !isComplete && !isCurrent && 'text-zinc-500',
                )}
              >
                {step}
              </span>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div className="flex-1 mx-2 h-px relative">
                <div className="absolute inset-0 bg-white/[0.08]" />
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 transition-all duration-500',
                    i < currentIndex ? 'bg-emerald-500/40 w-full' : 'w-0',
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rendition cards
// ---------------------------------------------------------------------------

const RENDITIONS = [
  { label: '1080p', resolution: '1920x1080', videoBitrate: '6 Mbps', audioBitrate: '192 Kbps', codec: 'H.264 Main', audio: 'AAC Stereo' },
  { label: '720p', resolution: '1280x720', videoBitrate: '3.5 Mbps', audioBitrate: '128 Kbps', codec: 'H.264 Main', audio: 'AAC Stereo' },
  { label: '540p', resolution: '960x540', videoBitrate: '1.8 Mbps', audioBitrate: '128 Kbps', codec: 'H.264 Main', audio: 'AAC Stereo' },
  { label: '360p', resolution: '640x360', videoBitrate: '800 Kbps', audioBitrate: '96 Kbps', codec: 'H.264 Main', audio: 'AAC Stereo' },
];

// ---------------------------------------------------------------------------
// Technical Details (hardcoded FFmpeg pipeline constants)
// ---------------------------------------------------------------------------

const TECHNICAL_DETAILS = [
  { label: 'Codec', value: 'H.264 (Main Profile)' },
  { label: 'Audio', value: 'AAC Stereo, 48 kHz' },
  { label: 'Container', value: 'fMP4 (Fragmented MP4)' },
  { label: 'Segment Duration', value: '6 seconds' },
  { label: 'Keyframe Interval', value: '2 seconds' },
  { label: 'Renditions', value: '4 (1080p / 720p / 540p / 360p)' },
];

// ---------------------------------------------------------------------------
// Processing Time helpers
// ---------------------------------------------------------------------------

function formatProcessingTime(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const diffMs = end - start;
  if (diffMs < 0) return '--';
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Thumbnail Gallery
// ---------------------------------------------------------------------------

function ThumbnailGallery({ objectIds }: { objectIds: string[] }) {
  const thumbnails = objectIds.slice(0, 6);
  if (thumbnails.length === 0) return null;

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-zinc-200 font-heading flex items-center gap-2 mb-3">
        <Image className="w-4 h-4 text-zinc-400" />
        Thumbnails
      </h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {thumbnails.map((objectId) => (
          <div
            key={objectId}
            className="relative flex-none w-36 aspect-video rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.03] group"
          >
            <img
              src={siaObjectUrl(objectId)}
              alt="Video thumbnail"
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div
              title={objectId}
              className="absolute inset-0 flex items-end justify-start p-1.5 pointer-events-none"
            >
              <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[10px] font-mono text-zinc-300">
                {truncateAddress(objectId, 6, 4)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sia Storage Section
// ---------------------------------------------------------------------------

function SiaStat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: typeof Cpu;
}) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-teal-400" />
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
          {label}
        </span>
      </div>
      <div className="text-lg font-semibold text-zinc-100 font-heading tabular-nums">
        {value}
      </div>
      {sub && <div className="text-[11px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function RedundancyGraphic({
  dataShards,
  parityShards,
}: {
  dataShards: number;
  parityShards: number;
}) {
  const data = Array.from({ length: dataShards });
  const parity = Array.from({ length: parityShards });
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1">
        {data.map((_, i) => (
          <div
            key={`d-${i}`}
            className="w-4 h-6 rounded-sm bg-teal-500/60 border border-teal-400/50"
            title="Data shard"
          />
        ))}
      </div>
      <span className="text-zinc-600 text-xs font-mono">+</span>
      <div className="flex items-center gap-1">
        {parity.map((_, i) => (
          <div
            key={`p-${i}`}
            className="w-4 h-6 rounded-sm bg-zinc-700/60 border border-zinc-600/50"
            title="Parity shard"
          />
        ))}
      </div>
      <span className="text-zinc-600 text-xs font-mono">=</span>
      <div className="text-sm font-semibold text-teal-400 font-heading">
        {((dataShards + parityShards) / dataShards).toFixed(1)}× redundancy
      </div>
    </div>
  );
}

function HostPill({ pubkey }: { pubkey: string }) {
  const shortKey =
    pubkey.length > 18 ? `${pubkey.slice(0, 10)}\u2026${pubkey.slice(-6)}` : pubkey;
  return (
    <a
      href={explorerUrls.host(pubkey)}
      {...EXTERNAL_LINK_PROPS}
      title={`View host ${pubkey} on ${EXPLORER_LABEL}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] hover:border-teal-500/30 transition-colors text-[11px] font-mono text-zinc-400 hover:text-teal-300"
    >
      <Server className="w-3 h-3 text-teal-400/70" />
      {shortKey}
      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
    </a>
  );
}

function ContractPill({ id }: { id: string }) {
  const short =
    id.length > 18 ? `${id.slice(0, 10)}\u2026${id.slice(-6)}` : id;
  return (
    <a
      href={explorerUrls.contract(id)}
      {...EXTERNAL_LINK_PROPS}
      title={`File contract ${id} on ${EXPLORER_LABEL}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-teal-500/[0.06] border border-teal-500/25 hover:bg-teal-500/[0.12] hover:border-teal-500/50 transition-colors text-[11px] font-mono text-teal-300 hover:text-teal-200"
    >
      <FileSignature className="w-3 h-3" />
      {short}
      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
    </a>
  );
}

function VariantRow({ variant }: { variant: SiaVariantInfo }) {
  return (
    <tr className="hover:bg-white/[0.03] transition-colors align-top">
      <td className="px-5 py-3">
        <div className="text-sm font-semibold text-zinc-100">
          {variant.resolution || '\u2014'}
        </div>
        <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
          {variant.bitrateKbps > 0 ? `${variant.bitrateKbps.toLocaleString()} kbps` : ''}
        </div>
      </td>
      <td className="px-5 py-3 text-xs">
        {variant.dataObjectId ? (
          <ObjectIdBadge value={variant.dataObjectId} truncate={6} />
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </td>
      <td className="px-5 py-3 text-xs">
        {variant.playlistObjectId ? (
          <ObjectIdBadge value={variant.playlistObjectId} truncate={6} />
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
        {formatBytes(variant.dataSize)}
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-zinc-500">
        {variant.encodedBytes !== null ? (
          formatBytes(variant.encodedBytes)
        ) : (
          <span className="text-zinc-700">—</span>
        )}
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
        {variant.segmentCount.toLocaleString()}
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-teal-300">
        {variant.hostCount}
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-zinc-400">
        {variant.slabCount}
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-zinc-400">
        {variant.sectorCount}
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-zinc-400 font-mono">
        {variant.minShards !== null && variant.totalShards !== null
          ? `${variant.minShards}/${variant.totalShards}`
          : '\u2014'}
      </td>
    </tr>
  );
}

function SiaStorageSection({ info }: { info: AssetSiaInfo }) {
  const {
    manifest,
    manifestObjectId,
    variants,
    totals,
    indexer,
  } = info;

  // Reed-Solomon parameters are only known once we've observed at least one
  // populated slab — the Sia SDK carries them as slab metadata, not a
  // renter-wide setting. If nothing has been pinned yet we show a
  // placeholder state instead of guessing.
  const hasShardInfo =
    totals.dataShards !== null && totals.parityShards !== null;

  return (
    <div className="bg-gradient-to-br from-teal-500/[0.04] via-transparent to-transparent bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
            <Database className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 font-heading">
              Sia Storage
            </h3>
            <p className="text-[11px] text-zinc-500">
              Decentralized on the Sia network
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="text-[10px] px-2 py-0.5 bg-teal-500/10 text-teal-400 border-teal-500/20"
            title={indexer.url}
          >
            <Network className="w-3 h-3 mr-1" />
            {indexer.network === 'zen' ? 'Zen Testnet' : 'Mainnet'}
          </Badge>
          {hasShardInfo && (
            <Badge
              variant="secondary"
              className="text-[10px] px-2 py-0.5 bg-white/[0.05] text-zinc-300 border-white/[0.08]"
              title="Reed-Solomon erasure coding (read from slab metadata)"
            >
              {totals.dataShards} + {totals.parityShards} shards
            </Badge>
          )}
        </div>
      </div>

      {/* Top stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-5">
        <SiaStat
          icon={Boxes}
          label="Sia Operations"
          value={totals.objectCount.toLocaleString()}
          sub="Total objects pinned"
        />
        <SiaStat
          icon={HardDrive}
          label="Raw Size"
          value={formatBytes(totals.rawBytes)}
          sub={
            totals.encodedBytes !== null
              ? `${formatBytes(totals.encodedBytes)} on hosts`
              : 'Encoded size pending'
          }
        />
        <SiaStat
          icon={Server}
          label="Hosts"
          value={totals.uniqueHostCount.toLocaleString()}
          sub="Unique hosts storing data"
        />
        <SiaStat
          icon={Shield}
          label="Redundancy"
          value={
            totals.redundancyRatio !== null ? (
              <>
                {totals.redundancyRatio.toFixed(2)}
                <span className="text-xs text-zinc-400 ml-1">×</span>
              </>
            ) : (
              <span className="text-zinc-500">—</span>
            )
          }
          sub={
            hasShardInfo
              ? `${totals.dataShards} data + ${totals.parityShards} parity per slab`
              : 'Slab metadata not yet available'
          }
        />
      </div>

      {/* Redundancy visualization — only when real slab metadata is present */}
      {hasShardInfo && totals.dataShards !== null && totals.parityShards !== null && (() => {
        // Derive totals from the single source of truth — the API's
        // totals.encodedBytes. Sectors are a 4 MiB protocol constant,
        // so N sectors × 4 MiB is guaranteed to equal encodedBytes.
        // (Previous local sum over manifest+variants omitted
        // thumbnails and drifted from the API's real number.)
        const SECTOR = 4 * 1024 * 1024;
        const totalSectors = totals.encodedBytes !== null
          ? Math.floor(totals.encodedBytes / SECTOR)
          : 0;
        const totalSlabs = totalSectors > 0
          ? Math.ceil(totalSectors / (totals.dataShards + totals.parityShards))
          : 0;
        return (
          <div className="mx-5 mb-5 bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">
                  Erasure Coding — observed across {totalSlabs} slab
                  {totalSlabs === 1 ? '' : 's'}
                </div>
                <div className="text-xs text-zinc-400 max-w-md">
                  Each slab stores{' '}
                  <span className="text-teal-400 font-semibold">
                    {totals.dataShards}
                  </span>{' '}
                  data +{' '}
                  <span className="text-zinc-300 font-semibold">
                    {totals.parityShards}
                  </span>{' '}
                  parity shards. Any {totals.dataShards} of{' '}
                  {totals.dataShards + totals.parityShards} reconstruct the
                  data. Total on hosts:{' '}
                  <span className="font-mono text-zinc-300">
                    {totalSectors} sector{totalSectors === 1 ? '' : 's'}
                  </span>{' '}
                  {totals.encodedBytes !== null && (
                    <>
                      {' '}× 4 MiB ={' '}
                      <span className="font-mono text-zinc-300">
                        {formatBytes(totals.encodedBytes)}
                      </span>
                    </>
                  )}
                  .
                </div>
              </div>
              <RedundancyGraphic
                dataShards={totals.dataShards}
                parityShards={totals.parityShards}
              />
            </div>
          </div>
        );
      })()}

      {/* Manifest row */}
      {manifestObjectId && (
        <div className="mx-5 mb-5 bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
            Master Manifest
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <ObjectIdBadge
              value={manifestObjectId}
              truncate={10}
              className="text-xs"
            />
            {manifest && (
              <div className="flex items-center gap-4 text-[11px] text-zinc-400 tabular-nums">
                <span>{formatBytes(manifest.size)}</span>
                <span>
                  {manifest.slabCount} slab{manifest.slabCount === 1 ? '' : 's'}
                </span>
                <span>
                  {manifest.sectorCount} sector
                  {manifest.sectorCount === 1 ? '' : 's'}
                </span>
                <span className="text-zinc-500">
                  on {manifest.hosts.length} host
                  {manifest.hosts.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Variants table */}
      {variants.length > 0 && (
        <div className="border-t border-white/[0.08] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.08] flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-sm font-semibold text-zinc-200 font-heading">
              Per-Variant Breakdown
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/[0.02] border-b border-white/[0.06]">
                  <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">
                    Rendition
                  </th>
                  <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">
                    Data Object
                  </th>
                  <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">
                    Playlist Object
                  </th>
                  <th className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">
                    Size
                  </th>
                  <th className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">
                    Encoded
                  </th>
                  <th className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">
                    Segments
                  </th>
                  <th className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">
                    Hosts
                  </th>
                  <th
                    className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5"
                    title="Number of 4 MiB sectors stored across all hosts"
                  >
                    Slabs
                  </th>
                  <th
                    className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5"
                    title="Physical 4 MiB sectors on hosts (real count from slab metadata)"
                  >
                    Sectors
                  </th>
                  <th
                    className="text-right text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5"
                    title="Reed-Solomon data/total shards per slab"
                  >
                    k/n
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {variants.map((v) => (
                  <VariantRow
                    key={v.playlistObjectId || v.dataObjectId || v.resolution}
                    variant={v}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Verified on Sia — on-chain proof panel */}
      {(totals.allContracts.length > 0 || totals.allHosts.length > 0) && (
        <div className="border-t border-white/[0.08] p-5 bg-teal-500/[0.02]">
          <div className="flex items-center gap-2 mb-1.5">
            <Shield className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-sm font-semibold text-zinc-100 font-heading">
              Verified on Sia
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 mb-4 max-w-2xl leading-relaxed">
            Every slab that has been flushed to hosts is committed by a Sia
            file contract — an on-chain obligation where the host has locked
            collateral to store the data until expiry. Click any contract or
            host ID below to independently verify it on {EXPLORER_LABEL}.
            Tiny sub-slab objects (manifests, playlists) may briefly sit in
            the indexer's packing buffer before the next flush.
          </p>

          {totals.allContracts.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <FileSignature className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-xs font-semibold text-zinc-200">
                  File contracts
                </span>
                <span className="text-[11px] text-zinc-500">
                  {totals.uniqueContractCount} on-chain contract
                  {totals.uniqueContractCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {totals.allContracts.map((id) => (
                  <ContractPill key={id} id={id} />
                ))}
              </div>
            </div>
          )}

          {totals.allHosts.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-200">
                  Hosts
                </span>
                <span className="text-[11px] text-zinc-500">
                  {totals.uniqueHostCount} unique host
                  {totals.uniqueHostCount === 1 ? '' : 's'} storing sectors
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {totals.allHosts.map((pubkey) => (
                  <HostPill key={pubkey} pubkey={pubkey} />
                ))}
              </div>
            </div>
          )}

          {info.indexer.walletAddress && (
            <a
              href={explorerUrls.address(info.indexer.walletAddress)}
              {...EXTERNAL_LINK_PROPS}
              title={`View this server's wallet on ${EXPLORER_LABEL}`}
              className="inline-flex items-center gap-1.5 text-[11px] text-teal-400 hover:text-teal-300 transition-colors mt-1"
            >
              <Wallet className="w-3 h-3" />
              View this server's on-chain activity on {EXPLORER_LABEL}
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function SiaStorageSectionLoader() {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-teal-400" />
        <span className="text-sm font-semibold text-zinc-200 font-heading">
          Sia Storage
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processing Logs Timeline
// ---------------------------------------------------------------------------

const STAGE_CONFIG: Record<string, { icon: typeof Cpu; color: string; bg: string; label: string }> = {
  transcode: { icon: Cpu, color: 'text-zinc-400', bg: 'bg-zinc-400/20', label: 'Transcode' },
  upload: { icon: HardDrive, color: 'text-violet-400', bg: 'bg-violet-400/20', label: 'Upload' },
  finalize: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-400/20', label: 'Finalize' },
};

function formatLogTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Parse a log message and return rich JSX with clickable links where applicable. */
function RichLogMessage({ message }: { message: string }) {
  // Check for object ID pattern: "object <id>"
  const objectMatch = message.match(/object\s+([A-Za-z0-9_/-]{10,})/);
  if (objectMatch) {
    const objectId = objectMatch[1];
    const idx = objectMatch.index!;
    const beforeText = message.slice(0, idx);
    const afterText = message.slice(idx + objectMatch[0].length);
    return (
      <span>
        {beforeText}object{' '}
        <span className="text-violet-400 font-mono">
          {truncateAddress(objectId, 8, 6)}
        </span>
        {afterText}
      </span>
    );
  }

  // Format segment counts and byte sizes for readability
  const formattedMessage = message
    .replace(/(\d{4,})(\s*bytes)/gi, (_match, num, suffix) => {
      const n = parseInt(num, 10);
      if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB${suffix ? '' : ''}`;
      if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
      if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${num}${suffix}`;
    })
    .replace(/(\d+)\s+segments?/gi, (match) => match);

  return <span>{formattedMessage}</span>;
}

function ProcessingLogsTimeline({ logs }: { logs: ProcessingLog[] }) {
  if (!logs || logs.length === 0) return null;

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 backdrop-blur-sm">
      <h3 className="text-sm font-semibold text-zinc-200 font-heading flex items-center gap-2 mb-4">
        <Layers className="w-4 h-4 text-zinc-400" />
        Pipeline Activity
      </h3>
      <div className="relative ml-3">
        {/* Vertical timeline line */}
        <div className="absolute left-0 top-2 bottom-2 w-px bg-white/[0.08]" />

        <div className="space-y-3">
          {logs.map((log, index) => {
            const config = STAGE_CONFIG[log.stage] ?? STAGE_CONFIG.transcode;
            const Icon = config.icon;

            return (
              <div key={index} className="relative pl-6 group">
                {/* Timeline dot */}
                <div
                  className={cn(
                    'absolute left-0 top-1.5 w-2 h-2 rounded-full -translate-x-[3.5px] ring-2 ring-zinc-950',
                    config.bg,
                  )}
                />

                <div className="flex items-start gap-3">
                  {/* Timestamp */}
                  <span className="text-[10px] font-mono text-zinc-600 whitespace-nowrap pt-0.5 min-w-[60px]">
                    {formatLogTimestamp(log.timestamp)}
                  </span>

                  {/* Stage badge */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md whitespace-nowrap',
                      config.bg,
                      config.color,
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {config.label}
                  </span>

                  {/* Message */}
                  <span className="text-xs text-zinc-400 leading-relaxed pt-0.5">
                    <RichLogMessage message={log.message} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embed Code Generator
// ---------------------------------------------------------------------------

function EmbedCodeGenerator({ assetId, playbackUrl }: { assetId: string; playbackUrl?: string }) {
  const hlsUrl = playbackUrl ?? `${BASE_URL}/api/v1/playback/${assetId}/hls`;

  const htmlCode = `<video
  src="${hlsUrl}"
  data-asset-id="${assetId}"
  width="640"
  height="360"
  controls
></video>`;

  const reactCode = `<SlubyPlayer
  src="${hlsUrl}"
  assetId="${assetId}"
  autoPlay={false}
  controls
/>`;

  const sdkCode = `import { SlubyClient } from '@sluby/sdk';

const client = new SlubyClient({
  apiKey: 'YOUR_API_KEY',
  baseUrl: '${BASE_URL}',
});

const playback = await client.getPlayback('${assetId}');
console.log('HLS URL:', playback.playbackUrl);`;

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
      <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-4">Embed Code</h3>
      <Tabs defaultValue="html">
        <TabsList className="bg-white/[0.04] rounded-lg p-0.5">
          <TabsTrigger value="html" className="rounded-md text-xs data-[state=active]:bg-white/[0.07]">HTML</TabsTrigger>
          <TabsTrigger value="react" className="rounded-md text-xs data-[state=active]:bg-white/[0.07]">React</TabsTrigger>
          <TabsTrigger value="sdk" className="rounded-md text-xs data-[state=active]:bg-white/[0.07]">SDK</TabsTrigger>
        </TabsList>
        <TabsContent value="html">
          <div className="relative">
            <pre className="bg-[#0a0a0f] border border-white/[0.08] rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto">
              {htmlCode}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={htmlCode} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="react">
          <div className="relative">
            <pre className="bg-[#0a0a0f] border border-white/[0.08] rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto">
              {reactCode}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={reactCode} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="sdk">
          <div className="relative">
            <pre className="bg-[#0a0a0f] border border-white/[0.08] rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto">
              {sdkCode}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={sdkCode} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata Card
// ---------------------------------------------------------------------------

function MetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.08] last:border-b-0">
      <span className="text-xs text-zinc-400">{label}</span>
      <span className="text-xs text-zinc-200">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton Loading
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <PageContainer>
      <div className="space-y-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <div className="flex gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    </PageContainer>
  );
}


// ---------------------------------------------------------------------------
// Sia Objects Section (collapsible)
// ---------------------------------------------------------------------------

function SiaObjectsSection({
  manifestId,
  thumbnailIds,
}: {
  manifestId: string | null;
  thumbnailIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const totalObjects = (manifestId ? 1 : 0) + thumbnailIds.length;

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-semibold text-zinc-200 font-heading">
            Sia Objects
          </h3>
          <Badge variant="secondary" className="text-[10px] px-2 py-0.5 ml-1 bg-teal-500/10 text-teal-400 border-teal-500/20">
            {totalObjects}
          </Badge>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-3 border-t border-white/[0.08]">
          <p className="text-xs text-zinc-500">
            Every asset artifact is stored on the Sia network. Object
            identifiers are app-layer hashes — they are not consensus-layer
            entities and do not appear on {EXPLORER_LABEL}.
          </p>
          {manifestId && (
            <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-xs text-zinc-400">Manifest</span>
              </div>
              <ObjectIdBadge value={manifestId} />
            </div>
          )}
          {thumbnailIds.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Image className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs text-zinc-400">
                  Thumbnails ({thumbnailIds.length})
                </span>
              </div>
              <ul className="space-y-1.5">
                {thumbnailIds.map((id, i) => (
                  <li
                    key={id}
                    className="flex items-center justify-between text-xs pl-5"
                  >
                    <span className="text-zinc-500 font-mono">#{i + 1}</span>
                    <ObjectIdBadge value={id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: asset, isLoading, isError, refetch } = useAsset(id);
  const siaInfo = useAssetSiaInfo(
    asset?.status === 'ready' && asset?.manifest_object_id ? id : undefined,
  );
  const playback = usePlayback(asset?.status === 'ready' ? id : undefined);
  // Fetch processing job both while processing AND when ready (to show timing data)
  const processingJob = useProcessingJob(
    id,
    asset?.status === 'processing' || asset?.status === 'uploading' || asset?.status === 'ready',
  );
  const updateAsset = useUpdateAsset();
  const deleteAsset = useDeleteAsset();

  if (isLoading) return <DetailSkeleton />;

  if (isError || !asset) {
    return (
      <PageContainer>
        <div className="bg-white/[0.03] border border-red-500/20 rounded-2xl p-8 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-400 mb-3">Failed to load asset</p>
          <div className="flex items-center gap-2 justify-center">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </Button>
            <Button variant="ghost" size="sm" asChild className="bg-white/[0.04] hover:bg-white/[0.07] text-zinc-300">
              <Link to="/studio/assets">Back to Library</Link>
            </Button>
          </div>
        </div>
      </PageContainer>
    );
  }

  const handleSaveTitle = (title: string) => {
    updateAsset.mutate({ id: asset.id, data: { title } });
  };

  const handleSaveDescription = (description: string) => {
    updateAsset.mutate({ id: asset.id, data: { description } });
  };

  const handleDelete = () => {
    deleteAsset.mutate(asset.id, {
      onSuccess: () => navigate('/studio/assets'),
    });
  };

  // Compute processing time from the job data
  const jobData = processingJob.data;
  const hasProcessingTiming = !!(jobData?.started_at && jobData?.completed_at);

  return (
    <PageContainer>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-6">
        {/* ── HEADER ── */}
        <div>
          <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-zinc-400 hover:text-zinc-200 mb-3">
            <Link to="/studio/assets">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Library
            </Link>
          </Button>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <InlineEditable
                value={asset.title}
                onSave={handleSaveTitle}
                isSaving={updateAsset.isPending}
                className="text-2xl font-bold text-[#f0f0f0] font-heading"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={asset.status} />
              <AccessTierBadge tier={asset.access_tier} />
              {asset.status === 'ready' && (
                <Button variant="outline" size="sm" asChild className="gap-1.5 bg-white/[0.04] hover:bg-white/[0.07]">
                  <Link to={`/studio/player?asset=${asset.id}`}>
                    <Play className="w-3.5 h-3.5" />
                    Play
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── INFO STRIP ── */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-400">
          {asset.resolution && (
            <span className="flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5 text-zinc-500" />
              {asset.resolution}
            </span>
          )}
          {asset.duration_ms > 0 && (
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              {formatDuration(asset.duration_ms)}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
            {formatBytes(asset.total_storage_bytes ?? 0)}
          </span>
          {asset.segment_count > 0 && (
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-zinc-500" />
              {asset.segment_count} segments
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            {formatRelativeTime(asset.created_at)}
          </span>
          {asset.updated_at && asset.updated_at !== asset.created_at && (
            <span className="flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
              Updated {formatRelativeTime(asset.updated_at)}
            </span>
          )}
        </div>

        {/* ── PROCESSING TIMELINE (when completed) ── */}
        {asset.status === 'ready' && hasProcessingTiming && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Timer className="w-3.5 h-3.5" />
              Processing Time: {formatProcessingTime(jobData!.started_at!, jobData!.completed_at!)}
            </span>
            <span className="text-zinc-500 text-xs">
              Started {formatTimestamp(jobData!.started_at!)}
            </span>
            <span className="text-zinc-500 text-xs">
              Completed {formatTimestamp(jobData!.completed_at!)}
            </span>
          </div>
        )}

        {/* ── DESCRIPTION ── */}
        <div>
          <InlineEditable
            value={asset.description || ''}
            onSave={handleSaveDescription}
            isSaving={updateAsset.isPending}
            as="textarea"
            className="text-sm text-zinc-400"
          />
        </div>

        {/* ── THUMBNAIL GALLERY ── */}
        {asset.thumbnail_object_ids && asset.thumbnail_object_ids.length > 0 && (
          <ThumbnailGallery objectIds={asset.thumbnail_object_ids} />
        )}

        {/* ── SIA OBJECTS ── */}
        {(asset.manifest_object_id || (asset.thumbnail_object_ids && asset.thumbnail_object_ids.length > 0)) && (
          <SiaObjectsSection
            manifestId={asset.manifest_object_id}
            thumbnailIds={asset.thumbnail_object_ids ?? []}
          />
        )}

        {/* ── SIA STORAGE ── Only when asset is ready & manifest exists */}
        {asset.status === 'ready' && asset.manifest_object_id && (
          siaInfo.isLoading && !siaInfo.data ? (
            <SiaStorageSectionLoader />
          ) : siaInfo.data ? (
            <SiaStorageSection info={siaInfo.data} />
          ) : null
        )}

        {/* ── TECHNICAL DETAILS ── */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-zinc-200 font-heading flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-zinc-400" />
            Technical Details
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            {TECHNICAL_DETAILS.map((item) => (
              <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-white/[0.06] last:border-b-0">
                <span className="text-xs text-zinc-400">{item.label}</span>
                <span className="text-xs font-medium text-zinc-200">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── PROCESSING PIPELINE ── Only when not ready */}
        {asset.status !== 'ready' && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-zinc-200 font-heading mb-4">Processing Pipeline</h3>
            <PipelineStepper status={asset.status} />
            {processingJob.data && (asset.status === 'processing' || asset.status === 'uploading') && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-zinc-400">
                    {processingJob.data.progress_percent <= 80 ? 'Transcoding...' : processingJob.data.progress_percent < 100 ? 'Uploading to Sia...' : 'Finalizing...'}
                  </span>
                  <span className="text-xs font-mono text-zinc-400 tabular-nums">{processingJob.data.progress_percent}%</span>
                </div>
                <Progress value={processingJob.data.progress_percent} />
              </div>
            )}
          </div>
        )}

        {/* ── EMBED CODE ── Only when ready */}
        {asset.status === 'ready' && (
          <EmbedCodeGenerator assetId={asset.id} playbackUrl={playback.data?.playback_url} />
        )}

        {/* ── RENDITIONS ── */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
            <h3 className="text-sm font-semibold text-zinc-200 font-heading flex items-center gap-2">
              <Film className="w-4 h-4 text-zinc-400" />
              Renditions
            </h3>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-teal-500/10 text-teal-400 border-teal-500/20" title="HTTP Live Streaming">HLS</Badge>
              <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-violet-500/10 text-violet-400 border-violet-500/20" title="Fragmented MPEG-4">fMP4</Badge>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-white/[0.03]">
                  <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">Quality</th>
                  <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">Resolution</th>
                  <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">Bitrate</th>
                  <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">Codec</th>
                  <th className="text-left text-[10px] font-medium text-zinc-500 uppercase tracking-wider px-5 py-2.5">Audio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {RENDITIONS.map((r) => (
                  <tr key={r.label} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-5 py-2.5">
                      <span className="text-sm font-semibold text-zinc-200">{r.label}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-zinc-300">{r.resolution}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-zinc-300">{r.videoBitrate} video</span>
                        <span className="text-zinc-500 text-[10px]">{r.audioBitrate} audio</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="text-zinc-400">{r.codec}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="text-zinc-400">{r.audio}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer details */}
          <div className="flex items-center gap-4 px-5 py-3 border-t border-white/[0.08] bg-white/[0.01]">
            <span className="text-[10px] text-zinc-500">Keyframe interval: <span className="text-zinc-400">2s</span></span>
            <span className="text-[10px] text-zinc-500">Segment duration: <span className="text-zinc-400">6s</span></span>
          </div>
        </div>

        {/* ── DANGER ZONE ── */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-red-400 font-heading">Danger Zone</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Permanently delete this video and all associated data</p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} className="gap-1.5">
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </Button>
        </div>
      </motion.div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Asset</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{asset.title}&rdquo;? This will permanently
              remove the video, all renditions, and Sia storage objects. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)} className="bg-white/[0.04] hover:bg-white/[0.07] text-zinc-300">
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
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
