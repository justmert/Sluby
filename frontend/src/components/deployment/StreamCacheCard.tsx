import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { DeploymentStatus } from '@/hooks/useStats';
import { formatBytes, formatCount, NO_VALUE, plural } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ratio } from './health';
import { HealthCard } from './parts';

const TITLE = 'Stream cache';
const DESCRIPTION = 'Video files this server keeps in memory';

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}

const grid = 'grid grid-cols-2 gap-4 @2xl/page:grid-cols-4';

export function StreamCacheCard({ status }: { status?: DeploymentStatus }) {
  const cache = status?.cache;
  if (!cache) {
    return (
      <HealthCard title={TITLE} description={DESCRIPTION}>
        <div aria-hidden="true" className={grid}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className={cn('h-4 w-16', lateReveal)} />
              <Skeleton className={cn('h-5 w-24', lateReveal)} />
            </div>
          ))}
        </div>
      </HealthCard>
    );
  }
  const lookups = cache.hits + cache.misses;
  return (
    <HealthCard title={TITLE} description={DESCRIPTION}>
      <dl className={grid}>
        <Figure label="Hit ratio">
          {lookups > 0 ? (
            <span className="font-heading text-figure-sm">
              {Math.round((cache.hits / lookups) * 100)}%
            </span>
          ) : (
            <span className="text-muted-foreground">{NO_VALUE} No lookups yet</span>
          )}
        </Figure>
        <Figure label="Hits / misses">
          {formatCount(cache.hits)} / {formatCount(cache.misses)}
        </Figure>
        <Figure label="Cached entries">
          {plural(cache.object_items, 'file')}, {plural(cache.manifest_items, 'playlist')}
        </Figure>
        <Figure label="Memory used">
          <span className="flex flex-col gap-1.5">
            <span>
              {formatBytes(cache.object_bytes)} of {formatBytes(cache.object_max_bytes)}
            </span>
            <Progress
              smooth
              value={ratio(cache.object_bytes, cache.object_max_bytes)}
              aria-label="Stream cache memory used"
            />
          </span>
        </Figure>
      </dl>
    </HealthCard>
  );
}
