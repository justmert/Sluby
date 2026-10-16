import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { HEALTH_GRID } from './health';
import { ServiceCardsLoading } from './ServiceCards';
import { SiaAccountLoading } from './SiaAccountCard';
import { StorageCheckLoading } from './StorageCheckCard';

/**
 * The checked line under the title before the first answer. It sits in the
 * header's paragraph, so it is a span at the line's height, not a block.
 */
export function HealthCheckedLoading() {
  return (
    <span aria-hidden="true" className="flex h-5 items-center">
      <span className={cn('block h-3.5 w-64 max-w-full rounded-md bg-muted', lateReveal)} />
    </span>
  );
}

/** The overall verdict chip before the first answer. */
export function HealthChipLoading() {
  return <Skeleton className={cn('h-7 w-44 rounded-full', lateReveal)} />;
}

/**
 * Health as it first draws, before any answer: what the page shows until its
 * first answers are in, and what a route skeleton can show while the page's
 * code loads.
 */
export function HealthLoading() {
  return (
    <div className={HEALTH_GRID.stack}>
      <ServiceCardsLoading />
      <div className={HEALTH_GRID.pair}>
        <SiaAccountLoading />
        <StorageCheckLoading />
      </div>
    </div>
  );
}
