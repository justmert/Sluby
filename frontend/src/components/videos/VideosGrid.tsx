import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { RetryProcessingButton } from '@/components/asset/RetryProcessingButton';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import type { RowAction } from '@/components/shared/DataTable';
import { selectRange } from '@/components/shared/select-range';
import { Checkbox } from '@/components/ui/checkbox';
import { isStaleUpload, useSendingAssetIds } from '@/hooks/asset-queries';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useRowJob, videoMeta } from './video-progress';
import { VideoRowMenu } from './VideoRowMenu';
import { VideoStatusChip } from './VideoStatusChip';

const GRID =
  'grid grid-cols-1 gap-4 @xl/page:grid-cols-2 @4xl/page:grid-cols-3 @6xl/page:grid-cols-4';

function VideoCard({
  asset,
  selected,
  selecting,
  actions,
  onToggle,
}: {
  asset: VideoAsset;
  selected: boolean;
  /** something on the page is selected, so every box stays visible */
  selecting: boolean;
  actions: RowAction[];
  onToggle: (shift: boolean) => void;
}) {
  const { progress, failure } = useRowJob(asset);
  // an old upload another tab is still sending is not interrupted
  const sending = useSendingAssetIds();
  const stale = isStaleUpload(asset) && !sending.has(asset.id);
  const href = ROUTES.video(asset.id);
  const shift = useRef(false);
  return (
    <div
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-colors duration-150 ease-design',
        selected && 'border-border-strong bg-muted',
      )}
    >
      {/* the title link below names the video; this one is a larger mouse target */}
      <Link to={href} tabIndex={-1} aria-hidden="true" className="relative block">
        <AssetThumbnail
          size="md"
          thumbnailObjectIds={asset.thumbnailObjectIds}
          isPrivate={asset.accessTier === 'private'}
          processing={progress}
          failed={asset.status === 'failed'}
          className="w-full rounded-none"
          imageClassName="motion-safe:transition-[opacity,scale] motion-safe:duration-300 motion-safe:group-hover:scale-[1.03]"
        />
      </Link>
      <label
        data-slot="select-target"
        data-visible={selected || selecting || undefined}
        className={cn(
          'absolute top-2 left-2 flex size-8 cursor-pointer items-center justify-center rounded-md border bg-card transition-opacity duration-150 ease-design',
          // on a mouse the box waits for hover or focus; touch has no hover, so it always shows
          'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-within:opacity-100 pointer-fine:data-visible:opacity-100',
        )}
      >
        <Checkbox
          checked={selected}
          onClick={(e) => (shift.current = e.shiftKey)}
          onCheckedChange={() => {
            onToggle(shift.current);
            shift.current = false;
          }}
          aria-label={`Select ${asset.title}`}
        />
      </label>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <Link
            to={href}
            data-video-link={asset.id}
            dir="auto"
            className="line-clamp-2 rounded-sm font-semibold text-foreground wrap-anywhere hover:text-primary"
          >
            {asset.title}
          </Link>
          <p
            className={cn(
              'mt-0.5 text-xs tabular-nums',
              failure ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {progress?.checking
              ? 'Checking again in a few seconds'
              : failure
                ? failure.body
                : stale
                  ? 'Upload interrupted'
                  : videoMeta(asset)}
          </p>
          {/* min-h-6 holds room for a failed video's Retry before its reason loads */}
          <div className="mt-2 flex min-h-6 flex-wrap items-center gap-2">
            <VideoStatusChip asset={asset} progress={progress} stale={stale} percent />
            {failure?.action === 'retry' && (
              <RetryProcessingButton asset={asset} named compact variant="outline" size="xs" />
            )}
          </div>
        </div>
        <VideoRowMenu actions={actions} title={asset.title} className="-mt-1 -mr-1" />
      </div>
    </div>
  );
}

export interface VideosGridProps {
  assets: VideoAsset[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  actions: (asset: VideoAsset) => RowAction[];
  staggerIn: boolean;
  busy: boolean;
}

/**
 * The library as tiles, the alternative to the table, in the table's own
 * card, chip and selection language. A processing video's tile shows its
 * stage and percent, a failed one its reason in red; titles wrap to two
 * lines (A11Y-27). Shift-click selects a range.
 */
export function VideosGrid({
  assets,
  selected,
  onSelectedChange,
  actions,
  staggerIn,
  busy,
}: VideosGridProps) {
  const [mountedIds] = useState(() => new Set(assets.map((a) => a.id)));
  const initialFor = (id: string) => (staggerIn || !mountedIds.has(id) ? undefined : false);
  const anchor = useRef<string | null>(null);
  const ids = assets.map((a) => a.id);
  const toggle = (id: string, shift: boolean) => {
    onSelectedChange(
      selectRange(ids, selected, shift ? anchor.current : null, id, !selected.has(id)),
    );
    anchor.current = id;
  };
  return (
    <AnimatedList as="ul" aria-label="Videos" aria-busy={busy || undefined} className={GRID}>
      {assets.map((asset) => (
        <AnimatedItem key={asset.id} as="li" initial={initialFor(asset.id)}>
          <VideoCard
            asset={asset}
            selected={selected.has(asset.id)}
            selecting={selected.size > 0}
            actions={actions(asset)}
            onToggle={(shift) => toggle(asset.id, shift)}
          />
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}
