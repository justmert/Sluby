import type { VideoAsset } from '@sluby/sdk';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { lateReveal } from '@/lib/motion';
import { useUploadSheet } from '@/lib/upload-sheet';
import { cn } from '@/lib/utils';

/**
 * Picks the video whose ID the snippets use. Without a ready video the
 * snippets keep the YOUR_VIDEO_ID placeholder and this says why.
 */
export function VideoPicker({
  videos,
  selected,
  error,
  onChange,
  onRetry,
  retrying = false,
}: {
  videos: VideoAsset[] | undefined;
  selected: VideoAsset | null | undefined;
  error: unknown;
  onChange: (id: string) => void;
  /** loads the videos again after a failure */
  onRetry: () => unknown;
  retrying?: boolean;
}) {
  const upload = useUploadSheet();
  if (selected === undefined) return <VideoPickerSkeleton />;
  if (error && !videos) {
    // the snippets still work with the placeholder; the full reason is under Details
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>Could not load your videos, so the snippets use YOUR_VIDEO_ID.</span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() => void onRetry()}
          disabled={retrying}
        >
          {retrying ? 'Trying again…' : 'Try again'}
        </Button>
        <ErrorDetails detail={errorText(error)} className="basis-full" />
      </div>
    );
  }
  if (!selected || !videos) {
    return (
      <p className="text-sm text-muted-foreground">
        The snippets use YOUR_VIDEO_ID until a video is ready.{' '}
        <button
          type="button"
          onClick={() => upload.open()}
          className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          Upload a video
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Label htmlFor="snippet-video" className="shrink-0">
        Video
      </Label>
      <Select value={selected.id} onValueChange={onChange}>
        <SelectTrigger
          id="snippet-video"
          className="w-full max-w-sm min-w-0 sm:w-72"
          aria-describedby="snippet-video-help"
        >
          <SelectValue />
        </SelectTrigger>
        {/* a list under the field, as wide as it, so long titles truncate instead of running off a phone */}
        <SelectContent
          position="popper"
          className="w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)]"
        >
          {videos.map((v) => (
            // the whole title stays a tooltip; the item itself ends it in an ellipsis
            <SelectItem key={v.id} value={v.id} title={v.title || undefined}>
              {v.title || 'Untitled video'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id="snippet-video-help" className="text-xs text-muted-foreground">
        Fills its video ID into these snippets
      </p>
    </div>
  );
}

/** The picker's label, field and help line while the videos load, in the same boxes. */
export function VideoPickerSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-hidden="true">
      <Skeleton className={cn('my-0.5 h-4 w-10', lateReveal)} />
      <Skeleton
        className={cn('h-8 w-full max-w-sm min-w-0 pointer-coarse:h-10 sm:w-72', lateReveal)}
      />
      <Skeleton className={cn('my-0.5 h-3 w-56', lateReveal)} />
    </div>
  );
}
