import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
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
import { PICKER_HELP, PICKER_HELP_ID, VideoPickerSkeleton } from './VideoPickerSkeleton';

const access = (v: VideoAsset) => (v.accessTier === 'private' ? 'Private' : 'Public');

/**
 * Picks the video whose ID the snippets use, under the quickstart's first
 * step heading (`labelledBy`), which names the field. Without a ready video
 * the snippets keep the YOUR_VIDEO_ID placeholder and this says why.
 */
export function VideoPicker({
  videos,
  selected,
  error,
  onChange,
  onRetry,
  retrying = false,
  labelledBy,
}: {
  videos: VideoAsset[] | undefined;
  selected: VideoAsset | null | undefined;
  error: unknown;
  onChange: (id: string) => void;
  /** loads the videos again after a failure */
  onRetry: () => unknown;
  retrying?: boolean;
  /** the id of the heading that names the field */
  labelledBy: string;
}) {
  if (selected === undefined) return <VideoPickerSkeleton />;
  if (error && !videos) {
    // the snippets still work with the placeholder; the full reason is under Details
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <span>Could not load your videos, so the snippets use YOUR_VIDEO_ID.</span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-sm"
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
      <p className="text-muted-foreground">
        The snippets use YOUR_VIDEO_ID until a video is ready.{' '}
        <Link
          to={ROUTES.UPLOAD}
          className="rounded-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Upload a video
        </Link>
      </p>
    );
  }
  return (
    <>
      <p id={PICKER_HELP_ID} className="text-muted-foreground">
        {PICKER_HELP}
      </p>
      <Select value={selected.id} onValueChange={onChange}>
        <SelectTrigger
          id="snippet-video"
          className="w-full max-w-[420px] min-w-0 bg-card data-[size=default]:h-9 pointer-coarse:data-[size=default]:h-10"
          aria-labelledby={labelledBy}
          aria-describedby={PICKER_HELP_ID}
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
              {`${v.title || 'Untitled video'} · ${access(v)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
