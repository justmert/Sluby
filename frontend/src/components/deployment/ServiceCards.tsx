import type { ReactNode } from 'react';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { Skeleton } from '@/components/ui/skeleton';
import type { Probe, SystemStatus } from '@/hooks/useStats';
import { formatBytes, formatCount } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { HEALTH_GRID, hostOf, probeText, type Tone } from './health';
import { Dot } from './parts';

const CARD = 'flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4.5 py-4 text-sm';

function ServiceCard({
  name,
  tone,
  detail,
  error,
  title,
}: {
  name: string;
  tone: Tone;
  detail: ReactNode;
  /** the raw probe error, folded under Details */
  error?: string;
  title?: string;
}) {
  return (
    <li className={CARD} data-slot="service" data-tone={tone}>
      <span className="flex items-center gap-2 font-semibold">
        <Dot tone={tone} />
        {name}
      </span>
      <span className="text-muted-foreground tabular-nums wrap-anywhere" title={title}>
        {detail}
      </span>
      {/* the raw error can be a long tls or socket line; it reads under Details, never as the headline */}
      <ErrorDetails detail={error} className="mt-1" />
    </li>
  );
}

const toneOf = (probe: Probe): Tone => (probe.ok ? 'ok' : 'bad');

/** "Redis · 1 ms · 0 waiting": the parts that are known, joined. */
const line = (...parts: Array<string | null | undefined | false>) =>
  parts.filter(Boolean).join(' · ');

/**
 * The four services Health starts with: database, queue, Sia indexer and the
 * stream cache. `queueDepth` comes from the metrics, so it is missing until
 * they load and null while the queue cannot be read.
 */
export function ServiceCards({
  status,
  queueDepth,
}: {
  status?: SystemStatus;
  queueDepth?: number | null;
}) {
  if (!status) return <ServiceCardsLoading />;
  const deployment = status.scope === 'deployment' ? status : undefined;
  const cache = deployment?.cache;
  const lookups = cache ? cache.hits + cache.misses : 0;
  const { database, redis, indexer } = status;
  return (
    <ul aria-label="Services" className={HEALTH_GRID.services}>
      <ServiceCard
        name="Database"
        tone={toneOf(database)}
        detail={line('PostgreSQL', probeText(database))}
        error={database.error}
      />
      <ServiceCard
        name="Queue"
        tone={toneOf(redis)}
        detail={line(
          'Redis',
          probeText(redis),
          redis.ok && typeof queueDepth === 'number' && `${formatCount(queueDepth)} waiting`,
        )}
        error={redis.error}
      />
      <ServiceCard
        name="Sia indexer"
        tone={toneOf(indexer)}
        detail={line(
          deployment && hostOf(deployment.indexer.url),
          indexer.network,
          probeText(indexer),
        )}
        title={deployment?.indexer.url}
        error={deployment?.indexer.error}
      />
      {/* the cache lives in the server's memory, so it works whenever the server answers */}
      {cache && (
        <ServiceCard
          name="Stream cache"
          tone="ok"
          detail={line(
            `${formatBytes(cache.object_bytes)} of ${formatBytes(cache.object_max_bytes)}`,
            lookups > 0 ? `${Math.round((cache.hits / lookups) * 100)}% hits` : 'no lookups yet',
          )}
        />
      )}
    </ul>
  );
}

export function ServiceCardsLoading() {
  return (
    <div aria-hidden="true" className={HEALTH_GRID.services}>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={CARD}>
          <span className="flex h-5.5 items-center gap-2">
            <Skeleton className={cn('size-2 rounded-full', lateReveal)} />
            <Skeleton className={cn('h-3.5 w-20', lateReveal)} />
          </span>
          <span className="flex h-5.5 items-center">
            <Skeleton className={cn('h-3.5 w-36', lateReveal)} />
          </span>
        </div>
      ))}
    </div>
  );
}
