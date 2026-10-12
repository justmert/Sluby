import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

// the details card's eight rows, label and value
const ROWS = ['w-14', 'w-12', 'w-14', 'w-10', 'w-12', 'w-20', 'w-18', 'w-16'];

/**
 * The video page's boxes while it loads, laid out like the board: the title
 * row with its chip and two buttons, the player and the section tabs on the
 * left, the details, description and delete cards on the right. The page
 * and its route skeleton both draw it, so the video lands without moving
 * anything (A11Y-37).
 */
export function AssetDetailLoading() {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-5 text-sm', lateReveal)}>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-5.5 w-14 rounded-full" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="flex h-10 items-center gap-6 border-b">
            {['w-11', 'w-22', 'w-20', 'w-14', 'w-14'].map((w, i) => (
              <Skeleton key={i} className={cn('h-3.5', w)} />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div className="flex flex-[1_1_300px] flex-col gap-4">
          <div className="rounded-xl border bg-card px-5 py-4.5">
            <Skeleton className="mb-3 h-4 w-16" />
            <div className="flex flex-col gap-2.5">
              {ROWS.map((w, i) => (
                <div key={i} className="flex h-5.5 items-center justify-between">
                  <Skeleton className={cn('h-3.5', w)} />
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
