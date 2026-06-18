import { useState } from 'react';
import { Film, Play, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { siaObjectUrl } from '@/lib/sia';
import { formatAddress, formatDuration, formatRelativeTime, formatBytes } from '@/lib/formatters';
import { StatusBadge } from './StatusBadge';
import { AccessTierBadge } from './AccessTierBadge';
import { ObjectIdBadge } from './ObjectIdBadge';
import type { VideoAsset } from '@/types/assets';

export interface VideoCardProps {
  asset: VideoAsset;
  variant?: 'grid' | 'list';
  onPlay?: (asset: VideoAsset) => void;
  onEdit?: (asset: VideoAsset) => void;
  onDelete?: (asset: VideoAsset) => void;
  onClick?: (asset: VideoAsset) => void;
}

function GridCard({ asset, onPlay, onEdit, onDelete, onClick }: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(asset)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick?.(asset);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group cursor-pointer transition-all duration-300 ease-out',
        isHovered && 'scale-[1.02]',
      )}
    >
      {/* Thumbnail */}
      <div className={cn(
        'relative aspect-video rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.08] transition-all duration-300',
        isHovered && 'border-white/[0.12] shadow-lg shadow-black/20',
      )}>
        {(asset.thumbnailUrl || asset.thumbnailObjectIds?.[0]) ? (
          <img
            src={asset.thumbnailUrl ?? siaObjectUrl(asset.thumbnailObjectIds![0])}
            alt={asset.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/[0.02]">
            <Film className="h-10 w-10 text-zinc-600" />
          </div>
        )}

        {/* Duration badge */}
        {asset.duration != null && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-mono text-white backdrop-blur-sm">
            {formatDuration(asset.duration)}
          </span>
        )}

        {/* Hover overlay with actions */}
        <div className={cn(
          'absolute inset-0 flex items-center justify-center gap-2 bg-black/50 backdrop-blur-[2px] transition-all duration-300',
          isHovered && (onPlay || onEdit || onDelete) ? 'opacity-100' : 'opacity-0',
        )}>
          {onPlay && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPlay(asset);
              }}
              className="rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 transition-all duration-200 backdrop-blur-sm hover:scale-110"
              aria-label="Play"
            >
              <Play className="h-5 w-5" />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(asset);
              }}
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-all duration-200 backdrop-blur-sm hover:scale-110"
              aria-label="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(asset);
              }}
              className="rounded-full bg-white/10 p-2 text-white hover:bg-red-500/40 transition-all duration-200 backdrop-blur-sm hover:scale-110"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Info below thumbnail */}
      <div className="mt-3 space-y-1.5">
        <p className="text-sm font-medium text-zinc-200 truncate">{asset.title}</p>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={asset.status} />
          <AccessTierBadge tier={asset.accessTier} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          {asset.creatorAddress && (
            <span className="font-mono">{formatAddress(asset.creatorAddress)}</span>
          )}
          {asset.creatorAddress && asset.createdAt && <span>&middot;</span>}
          {asset.createdAt && <span>{formatRelativeTime(asset.createdAt)}</span>}
        </div>
        {asset.manifestObjectId && (
          <div onClick={(e) => e.stopPropagation()}>
            <ObjectIdBadge
              value={asset.manifestObjectId}
              truncate={6}
              className="text-[10px]"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ListCard({ asset, onPlay, onEdit, onDelete, onClick }: VideoCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(asset)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick?.(asset);
      }}
      className="group flex items-center gap-4 rounded-xl px-3 py-2.5 transition-all duration-200 hover:bg-white/[0.05] cursor-pointer border border-transparent hover:border-white/[0.08]"
    >
      {/* Small thumbnail */}
      <div className="relative h-[45px] w-[80px] flex-shrink-0 rounded-lg overflow-hidden bg-white/[0.03] border border-white/[0.08]">
        {(asset.thumbnailUrl || asset.thumbnailObjectIds?.[0]) ? (
          <img
            src={asset.thumbnailUrl ?? siaObjectUrl(asset.thumbnailObjectIds![0])}
            alt={asset.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Film className="h-5 w-5 text-zinc-600" />
          </div>
        )}
      </div>

      {/* Title + ID */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200 truncate">{asset.title}</p>
        <p className="text-xs font-mono text-zinc-500 truncate">{asset.id}</p>
      </div>

      {/* Status */}
      <StatusBadge status={asset.status} />

      {/* Access tier */}
      <AccessTierBadge tier={asset.accessTier} />

      {/* Resolution */}
      <span className="hidden md:inline text-xs font-mono text-zinc-400 w-16 text-right">
        {asset.resolution ?? '-'}
      </span>

      {/* Duration */}
      <span className="hidden md:inline text-xs font-mono text-zinc-400 tabular-nums w-14 text-right">
        {asset.duration != null ? formatDuration(asset.duration) : '-'}
      </span>

      {/* Storage */}
      <span className="hidden lg:inline text-xs text-zinc-500 w-16 text-right">
        {asset.totalStorage != null ? formatBytes(asset.totalStorage) : '-'}
      </span>

      {/* Created */}
      <span className="hidden xl:inline text-xs text-zinc-500 w-24 text-right">
        {formatRelativeTime(asset.createdAt)}
      </span>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
        {onPlay && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(asset);
            }}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-all duration-200"
            aria-label="Play"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(asset);
            }}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] transition-all duration-200"
            aria-label="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(asset);
            }}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function VideoCard(props: VideoCardProps) {
  const { variant = 'grid' } = props;

  if (variant === 'list') {
    return <ListCard {...props} />;
  }

  return <GridCard {...props} />;
}
