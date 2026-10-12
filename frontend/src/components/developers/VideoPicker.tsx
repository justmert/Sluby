import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/constants';
import { errorText } from '@/lib/errors';
import { VideoPickerSkeleton } from './VideoPickerSkeleton';

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
        <Link
          to={ROUTES.UPLOAD}
          className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          Upload a video
        </Link>
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
