import { PageHeader } from '@/components/shared/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';

/**
 * The video page's boxes while it loads: the header with its facts and
 * controls, the player and the side panel, then the section tabs. The page
 * and its route skeleton both draw it, so the video lands without moving
 * anything (A11Y-37).
 */
export function AssetDetailLoading() {
  return (
    <div aria-hidden="true" className={lateReveal}>
      <PageHeader
        title="Loading video"
        heading={<Skeleton className="h-8 w-80 max-w-full" />}
        meta={
          <>
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-56" />
          </>
        }
        secondaryActions={
          <>
            <Skeleton className="h-8 w-36" />
            <Skeleton className="size-8" />
          </>
        }
      />
      <div className="grid gap-6 @5xl/page:grid-cols-[minmax(0,1fr)_24rem] @7xl/page:grid-cols-[minmax(0,1fr)_28rem]">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl @5xl/page:h-auto" />
      </div>
      <Skeleton className="mt-10 h-8 w-80 max-w-full" />
    </div>
  );
}
