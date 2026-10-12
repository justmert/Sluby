import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

// skeletons match the real card boxes, and only fade in once loading has
// taken 150ms, so a fast answer never flashes them
export function VideosGridSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 @xl/page:grid-cols-2 @4xl/page:grid-cols-3 @6xl/page:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border bg-card"
          data-testid="asset-card-skeleton"
        >
          <Skeleton className={cn('aspect-video w-full rounded-none', lateReveal)} />
          <div className="p-3">
            <div className="flex h-5 items-center">
              <Skeleton className={cn('h-3.5 w-3/4', lateReveal)} />
            </div>
            <div className="mt-0.5 flex h-4 items-center">
              <Skeleton className={cn('h-3 w-1/2', lateReveal)} />
            </div>
            <Skeleton className={cn('mt-2 h-5.5 w-16 rounded-full', lateReveal)} />
          </div>
        </div>
      ))}
    </div>
  );
}
