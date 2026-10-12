import { useState } from 'react';
import { CircleAlert, Lock } from 'lucide-react';
import { Icons } from '@/lib/icons';
import { Progress } from '@/components/ui/progress';
import { siaObjectUrl } from '@/lib/sia';
import { cn } from '@/lib/utils';

interface AssetThumbnailProps {
  thumbnailObjectIds: string[];
  /** Private assets get a lock instead of a request the gateway would refuse. */
  isPrivate?: boolean;
  /** Only for a thumbnail shown without its title beside it; otherwise it is decorative. */
  alt?: string;
  className?: string;
  /** Classes for the image itself, e.g. a hover zoom driven by a parent group. */
  imageClassName?: string;
  /**
   * A video still being made: a striped tile with a thin bar along the
   * bottom, and in the `md` size the stage and percent ("Storing on Sia, 65%").
   */
  processing?: { label: string; percent: number | null };
  /** Processing failed: a red tint, and "Failed" in the `md` size. */
  failed?: boolean;
  /**
   * `sm` (default) is a list thumbnail, icons only. `md` is a grid tile with
   * room for words, and puts the private lock in a corner chip.
   */
  size?: 'sm' | 'md';
}

// thumbnails stream through the gateway, which answers 403 for a private
// asset, so those never ask and show a lock. a public one that fails still
// falls back to an icon rather than a broken image. the box keeps its 16:9
// shape whatever happens, and the image fades in over it once loaded. a
// video that is processing or failed has no image yet, so the box says what
// is happening instead of showing an empty film icon (VIS-31)
export function AssetThumbnail({
  thumbnailObjectIds,
  isPrivate = false,
  alt = '',
  className,
  imageClassName,
  processing,
  failed = false,
  size = 'sm',
}: AssetThumbnailProps) {
  const id = isPrivate ? undefined : thumbnailObjectIds[0];
  // per object id, so a reused box does not carry the last image's state
  const [loaded, setLoaded] = useState<string | null>(null);
  const [errored, setErrored] = useState<string | null>(null);
  const showImage = id && errored !== id && !processing && !failed;
  const md = size === 'md';

  const lock = (
    <Lock
      role="img"
      aria-label="Private video, no preview"
      className={cn(md ? 'size-3' : 'size-4 text-muted-foreground')}
    />
  );

  return (
    <div
      data-state={processing ? 'processing' : failed ? 'failed' : undefined}
      className={cn(
        'relative flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted',
        failed && 'border border-destructive/40 bg-card text-destructive',
        className,
      )}
    >
      {processing ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,transparent_0_10px,var(--color-progress)_10px_20px)] bg-size-[28.28px_28.28px] opacity-10 motion-safe:animate-stripes"
          />
          {md && (
            <span className="relative px-2 text-center text-xs font-medium text-progress-foreground tabular-nums">
              {processing.label}
            </span>
          )}
          {processing.percent !== null && (
            <Progress
              smooth
              value={processing.percent}
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-0.5 rounded-none bg-transparent [&>[data-slot=progress-indicator]]:bg-primary/60"
            />
          )}
        </>
      ) : failed ? (
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <CircleAlert aria-hidden="true" className="size-4" />
          {md && 'Failed'}
        </span>
      ) : showImage ? (
        <img
          src={siaObjectUrl(id)}
          alt={alt}
          loading="lazy"
          decoding="async"
          data-loaded={loaded === id || undefined}
          className={cn(
            'size-full object-cover opacity-0 transition-opacity duration-200 ease-out-soft data-loaded:opacity-100',
            imageClassName,
          )}
          onLoad={() => setLoaded(id)}
          onError={() => setErrored(id)}
        />
      ) : isPrivate && !md ? (
        lock
      ) : (
        <Icons.video className="size-5 text-muted-foreground" aria-hidden="true" />
      )}
      {isPrivate && md && (
        <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full border bg-background/90 px-1.5 py-0.5 text-xs font-medium text-foreground shadow-xs">
          {lock}
          <span aria-hidden="true">Private</span>
        </span>
      )}
    </div>
  );
}
