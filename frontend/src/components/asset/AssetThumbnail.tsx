import { useState } from 'react';
import { Film } from 'lucide-react';
import { siaObjectUrl } from '@/lib/sia';
import { cn } from '@/lib/utils';

interface AssetThumbnailProps {
  thumbnailObjectIds: string[];
  title: string;
  className?: string;
}

// thumbnails stream through the gateway; private assets answer 403 there
// (a copy cached while public within a minute), so fall back to an icon
// rather than a broken image
export function AssetThumbnail({ thumbnailObjectIds, title, className }: AssetThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const id = thumbnailObjectIds[0];

  return (
    <div
      className={cn(
        'flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted',
        className,
      )}
    >
      {id && !failed ? (
        <img
          src={siaObjectUrl(id)}
          alt={title}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Film className="size-5 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}
