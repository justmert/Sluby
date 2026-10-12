import { BytesStreamedCard } from './BytesStreamedCard';
import { HEALTH_GRID } from './health';
import { ServiceCardsLoading } from './ServiceCards';
import { SiaAccountLoading } from './SiaAccountCard';
import { StorageCheckLoading } from './StorageCheckCard';

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
      <BytesStreamedCard />
    </div>
  );
}
