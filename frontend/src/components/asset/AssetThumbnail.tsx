import { useState } from 'react';
import { Film, Lock } from 'lucide-react';
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
}

// thumbnails stream through the gateway, which answers 403 for a private
// asset, so those never ask and show a lock. a public one that fails still
// falls back to an icon rather than a broken image. the box keeps its 16:9
// shape whatever happens, and the image fades in over it once loaded
export function AssetThumbnail({
  thumbnailObjectIds,
  isPrivate = false,
  alt = '',
  className,
  imageClassName,
}: AssetThumbnailProps) {
  const id = isPrivate ? undefined : thumbnailObjectIds[0];
  // per object id, so a reused box does not carry the last image's state
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <div
      className={cn(
        'relative flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted',
        className,
      )}
    >
      {id && failed !== id ? (
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
          onError={() => setFailed(id)}
        />
      ) : isPrivate ? (
        <Lock
          role="img"
          aria-label="Private video, no preview"
          className="size-4 text-muted-foreground"
        />
      ) : (
        <Film className="size-5 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}
