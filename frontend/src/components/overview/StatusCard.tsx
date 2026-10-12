import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { InlineError } from '@/components/shared/InlineError';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Probe, SystemStatus } from '@/hooks/useStats';
import { healthOf } from '@/hooks/useSystemStatus';
import { ROUTES } from '@/lib/constants';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

// the verdict in the card's own words: "All working" reads better beside
// three OK rows than the Health page's "Operational"
const VERDICT = { ok: 'All working', degraded: 'Degraded', down: 'Down' } as const;

const probeValue = (p: Probe) => (p.ok ? `OK · ${p.latency_ms} ms` : 'Not responding');

function Row({ label, probe }: { label: string; probe: Probe }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', !probe.ok && 'font-medium text-destructive')}>
        {probeValue(probe)}
      </dd>
    </div>
  );
}

export function StatusLoading() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex h-5.5 items-center justify-between gap-4">
          <Skeleton className={cn('h-3.5 w-24', lateReveal)} />
          <Skeleton className={cn('h-3.5 w-20', lateReveal)} />
        </div>
      ))}
    </div>
  );
}

export const StatusBadgeLoading = () => (
  <Skeleton className={cn('ml-auto h-5.5 w-24 rounded-full', lateReveal)} />
);

/** The frame of the card, also drawn by the route skeleton. */
export function StatusFrame({
  badge,
  footer,
  children,
}: {
  badge?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="status-heading"
      className="flex min-w-0 flex-[1_1_280px] flex-col gap-3 rounded-xl border bg-card px-6 py-5"
    >
      <div className="flex items-center gap-2">
        <h2 id="status-heading" className="font-heading text-heading">
          Status
        </h2>
        {badge}
      </div>
      {children}
      {footer && <div className="mt-auto">{footer}</div>}
    </section>
  );
}

/**
 * Overview's status: one verdict and the three services behind it, the
 * database, the job queue and Sia storage. Operators get a way to the full
 * Health page; the internals live there (D-07).
 */
export function StatusCard({
  status,
  error,
  onRetry,
  retrying,
  operator,
}: {
  status?: SystemStatus;
  error: Error | null;
  onRetry: () => void;
  retrying: boolean;
  operator: boolean;
}) {
  const health = healthOf(status);
  return (
    <StatusFrame
      badge={
        status ? (
          <span className="ml-auto">
            <StatusBadge kind="health" status={health}>
              {health === 'unknown' ? undefined : (
                <>
                  {health === 'ok' && (
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-current"
                    />
                  )}
                  {VERDICT[health]}
                </>
              )}
            </StatusBadge>
          </span>
        ) : error ? null : (
          <StatusBadgeLoading />
        )
      }
      footer={
        operator && (
          <Link
            to={ROUTES.DEPLOYMENT}
            className="rounded-sm font-semibold text-primary hover:text-primary-hover"
          >
            Open health
          </Link>
        )
      }
    >
      {!status && error ? (
        <InlineError what="the status" error={error} onRetry={onRetry} retrying={retrying} />
      ) : !status ? (
        <StatusLoading />
      ) : (
        <>
          <dl className="flex flex-col gap-3">
            <Row label="Database" probe={status.database} />
            <Row label="Queue" probe={status.redis} />
            <Row label="Sia storage" probe={status.indexer} />
          </dl>
          {error && (
            <InlineError
              title="Status is out of date"
              error={error}
              note="Showing the last figures that loaded."
              onRetry={onRetry}
              retrying={retrying}
            />
          )}
        </>
      )}
    </StatusFrame>
  );
}
