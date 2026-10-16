import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

export const PICKER_HELP = 'Snippets below fill in this video’s ID.';
export const PICKER_HELP_ID = 'snippet-video-help';

/**
 * The video picker's help line and field while the videos load, in the same
 * boxes. Its own file, so the route skeleton can draw it without the select
 * in the first download.
 */
export function VideoPickerSkeleton() {
  return (
    <>
      <p className="text-muted-foreground">{PICKER_HELP}</p>
      <Skeleton
        aria-hidden="true"
        className={cn('h-9 w-full max-w-[420px] min-w-0 pointer-coarse:h-10', lateReveal)}
      />
    </>
  );
}
