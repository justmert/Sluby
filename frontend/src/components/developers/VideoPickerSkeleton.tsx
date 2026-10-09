import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The video picker's label, field and help line while the videos load, in
 * the same boxes. Its own file, so the route skeleton can draw it without
 * the select in the first download.
 */
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
