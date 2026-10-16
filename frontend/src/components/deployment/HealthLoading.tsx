import { ServicesCard } from './ServicesCard';
import { SiaAccountCard } from './SiaAccountCard';
import { StorageCheckLoading } from './StorageCheckCard';
import { StreamCacheCard } from './StreamCacheCard';
import { HEALTH_GRID } from './health';

/**
 * Health as it first draws, before any answer: what the page shows until its
 * first answers are in, and what a route skeleton can show while the page's
 * code loads.
 */
export function HealthLoading() {
  return (
    <>
      <div className={HEALTH_GRID.top}>
        <ServicesCard />
        <SiaAccountCard />
      </div>
      <div className={HEALTH_GRID.row}>
        <StorageCheckLoading />
      </div>
      <div className={HEALTH_GRID.row}>
        <StreamCacheCard />
      </div>
    </>
  );
}
