import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { RetryProcessingButton } from '@/components/asset/RetryProcessingButton';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import type { RowAction } from '@/components/shared/DataTable';
import { selectRange } from '@/components/shared/select-range';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { isStaleUpload } from '@/hooks/asset-queries';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useRowJob, videoMeta } from './video-progress';
import { VideoRowMenu } from './VideoRowMenu';

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
  const stale = isStaleUpload(asset);
  const href = ROUTES.video(asset.id);
  const shift = useRef(false);
  return (
    <Card
      className={cn(
        'group relative h-full scroll-mt-36 gap-0 overflow-hidden py-0 transition-[box-shadow] duration-150',
        selected && 'ring-2 ring-primary',
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
          'absolute top-2 left-2 flex size-8 cursor-pointer items-center justify-center rounded-md border bg-background shadow-sm transition-opacity duration-150',
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
            className="line-clamp-2 rounded-sm text-sm font-medium wrap-anywhere outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
          >
            {asset.title}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {progress?.checking
              ? 'Checking again in a few seconds'
              : failure
                ? failure.body
                : stale
                  ? 'Upload interrupted'
                  : videoMeta(asset)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge kind="asset" status={asset.status} />
            {failure?.action === 'retry' && (
              <RetryProcessingButton asset={asset} named compact variant="outline" size="xs" />
            )}
          </div>
        </div>
        <VideoRowMenu actions={actions} title={asset.title} />
      </div>
    </Card>
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
 * The library as cards, the alternative to the table. A processing video's
 * tile shows its stage and percent, a failed one a red tint (VIS-31 R2);
 * titles wrap to two lines (A11Y-27). Shift-click selects a range.
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
