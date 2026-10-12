import type { VideoAsset } from '@sluby/sdk';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { RowProgress } from './video-progress';

/**
 * A video's status chip in the lists. A processing video names its stage
 * ("Storing on Sia") instead of the plain "Processing", and with `percent`
 * adds where it is ("Storing on Sia · 72%"); an upload that stopped arriving
 * reads Interrupted. Live work keeps the pulsing dot.
 */
export function VideoStatusChip({
  asset,
  progress,
  stale = false,
  percent = false,
  className,
}: {
  asset: Pick<VideoAsset, 'status'>;
  progress?: RowProgress;
  /** created or uploading, and nothing has arrived for a while */
  stale?: boolean;
  /** put the percent in the chip, for a list with no progress bar of its own */
  percent?: boolean;
  className?: string;
}) {
  if (stale) return <StatusBadge kind="asset" status="interrupted" className={className} />;
  if (asset.status === 'processing' && progress) {
    return (
      <StatusBadge kind="asset" status="processing" className={className}>
        {percent && progress.percent !== null
          ? `${progress.stage} · ${progress.percent}%`
          : progress.stage}
      </StatusBadge>
    );
  }
  return <StatusBadge kind="asset" status={asset.status} className={className} />;
}

/** The thin bar under a processing title, with its percent beside it (board: 120px, 4px). */
export function InlineProgress({
  progress,
  title,
  className,
}: {
  progress: RowProgress;
  title: string;
  className?: string;
}) {
  if (progress.percent === null) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        {progress.stage}
        {progress.checking && '. Checking again in a few seconds'}
      </span>
    );
  }
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Progress
        smooth
        moving={progress.moving}
        value={progress.percent}
        aria-label={`${title}, ${progress.stage}`}
        className="h-1 w-30 shrink-0 bg-border"
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {progress.percent}%{progress.checking && ', checking again'}
      </span>
    </span>
  );
}
