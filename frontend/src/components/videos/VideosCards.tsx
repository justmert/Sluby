import { useState } from 'react';
import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import type { RowAction } from '@/components/shared/DataTable';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { isStaleUpload, useSendingAssetIds } from '@/hooks/asset-queries';
import { ROUTES } from '@/lib/constants';
import { formatDuration } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useRowJob } from './video-progress';
import { VideoStatusChip } from './VideoStatusChip';
import { VideoRowMenu } from './VideoRowMenu';

const CARD = 'flex gap-3 rounded-xl border bg-card p-3';

/** "0:30 · Public": the length when known, then who can watch. */
function facts(asset: VideoAsset): string {
  return [
    asset.durationMs ? formatDuration(asset.durationMs) : null,
    asset.accessTier === 'private' ? 'Private' : 'Public',
  ]
    .filter(Boolean)
    .join(' · ');
}

function VideoCard({ asset, actions }: { asset: VideoAsset; actions: RowAction[] }) {
  const { progress, failure } = useRowJob(asset);
  const sending = useSendingAssetIds();
  const stale = isStaleUpload(asset) && !sending.has(asset.id);
  const href = ROUTES.video(asset.id);
  const meta = progress
    ? progress.percent !== null
      ? `${progress.percent}%`
      : null
    : failure
      ? failure.body
      : stale
        ? 'Upload interrupted'
        : facts(asset);
  return (
    <div className={CARD}>
      <Link to={href} tabIndex={-1} aria-hidden="true" className="shrink-0">
        <AssetThumbnail
          thumbnailObjectIds={asset.thumbnailObjectIds}
          isPrivate={asset.accessTier === 'private'}
          processing={progress}
          failed={asset.status === 'failed'}
          className="w-24 rounded-lg"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to={href}
          data-video-link={asset.id}
          dir="auto"
          className="line-clamp-2 rounded-sm font-semibold text-foreground wrap-anywhere hover:text-primary"
        >
          {asset.title}
        </Link>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <VideoStatusChip asset={asset} progress={progress} stale={stale} />
          {meta && <span className="min-w-0 text-muted-foreground tabular-nums">{meta}</span>}
        </div>
        {progress && progress.percent !== null && (
          <Progress
            smooth
            moving={progress.moving}
            value={progress.percent}
            aria-label={`${asset.title}, ${progress.stage}`}
            className="mt-1.5 h-1"
          />
        )}
      </div>
      <VideoRowMenu actions={actions} title={asset.title} className="size-11 rounded-lg" />
    </div>
  );
}

export function VideosCardsSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={CARD}>
          <Skeleton className={cn('aspect-video w-24 shrink-0 rounded-lg', lateReveal)} />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className={cn('h-3.5 w-3/4', lateReveal)} />
            <Skeleton className={cn('h-5.5 w-16 rounded-full', lateReveal)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The library on a phone (the Phone board): one card per video with its
 * thumbnail, title, status chip, a short facts line, the bar of a video
 * being processed, and its ⋯ menu with a 44px target.
 */
export function VideosCards({
  assets,
  actions,
  staggerIn,
  busy,
}: {
  assets: VideoAsset[];
  actions: (asset: VideoAsset) => RowAction[];
  staggerIn: boolean;
  busy: boolean;
}) {
  const [mountedIds] = useState(() => new Set(assets.map((a) => a.id)));
  const initialFor = (id: string) => (staggerIn || !mountedIds.has(id) ? undefined : false);
  return (
    <AnimatedList
      as="ul"
      aria-label="Videos"
      aria-busy={busy || undefined}
      className="flex flex-col gap-2.5"
    >
      {assets.map((asset) => (
        <AnimatedItem key={asset.id} as="li" initial={initialFor(asset.id)}>
          <VideoCard asset={asset} actions={actions(asset)} />
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}
