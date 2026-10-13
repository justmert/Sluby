import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { HEALTH_GRID, OVERALL, shortAgo, useNow } from '@/components/deployment/health';
import {
  HealthCheckedLoading,
  HealthChipLoading,
  HealthLoading,
} from '@/components/deployment/HealthLoading';
import { ToneChip } from '@/components/deployment/parts';
import { ServiceCards } from '@/components/deployment/ServiceCards';
import { SiaAccountCard } from '@/components/deployment/SiaAccountCard';
import { StorageCheckCard } from '@/components/deployment/StorageCheckCard';
import { InlineError } from '@/components/shared/InlineError';
import { usePlatformMetrics } from '@/hooks/usePlatformMetrics';
import { useReconciliation, type SystemStatus } from '@/hooks/useStats';
import { formatUptime } from '@/lib/formatters';
import { SYSTEM_STATUS_POLL_MS, useSystemStatus } from '@/hooks/useSystemStatus';
import { PAGE_HEADS } from '@/components/layout/page-heads';

// how long the page holds its first draw for the status and the check, so
// the cards land at once instead of growing one by one
const FIRST_DRAW_WAIT_MS = 1_500;

/** "Checked 12 s ago. Refreshes every 20 s.", ticking, from when the answer arrived. */
function CheckedLine({
  updatedAt,
  stale,
  status,
}: {
  updatedAt: number;
  stale: boolean;
  status: SystemStatus;
}) {
  const now = useNow(1000);
  return (
    <span className="tabular-nums" title={new Date(updatedAt).toLocaleString()}>
      Checked {shortAgo(now - updatedAt)}.{' '}
      {stale
        ? 'Could not refresh.'
        : `Refreshes every ${Math.round(SYSTEM_STATUS_POLL_MS / 1000)} s.`}{' '}
      Backend v{status.version}
      {status.scope === 'deployment' &&
        `, running for ${formatUptime(status.uptime_seconds * 1000)}`}
      .
    </span>
  );
}

// operators only: App.tsx wraps the route in OperatorOnly
export default function HealthPage() {
  const system = useSystemStatus({ poll: true });
  const status = system.data;
  const deployment = status?.scope === 'deployment' ? status : undefined;
  // the server only sends the summary to an account that is not the platform identity
  const summaryOnly = status?.scope === 'account';
  const failed = system.isError && !status;
  const run = useReconciliation();
  // the queue length comes from the metrics registry
  const metrics = usePlatformMetrics(true);
  const settled = !system.isPending && !run.isPending;
  const [cached] = useState(settled);
  const [waited, setWaited] = useState(cached);
  useEffect(() => {
    if (waited) return;
    const id = window.setTimeout(() => setWaited(true), FIRST_DRAW_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [waited]);
  const ready = settled || waited;
  const overall = status ? OVERALL[status.status] : null;

  return (
    <PageContainer>
      <PageHeader
        title={PAGE_HEADS.health.title}
        className="mb-5"
        description={
          status ? (
            <CheckedLine updatedAt={system.dataUpdatedAt} stale={system.isError} status={status} />
          ) : failed ? (
            PAGE_HEADS.health.description
          ) : (
            <HealthCheckedLoading />
          )
        }
        secondaryActions={
          overall ? (
            <ToneChip tone={overall.tone} dot className="h-7 px-3 text-[13px]">
              <span role="status">{overall.label}</span>
            </ToneChip>
          ) : failed ? null : (
            <HealthChipLoading />
          )
        }
      />

      {!ready ? (
        <HealthLoading />
      ) : (
        <div className={HEALTH_GRID.stack}>
          {failed ? (
            <InlineError
              what="this server's status"
              error={system.error}
              onRetry={() => void system.refetch()}
              retrying={system.isFetching}
            />
          ) : (
            system.isError && (
              <InlineError
                title="Status is out of date"
                error={system.error}
                note="Showing the last figures that loaded."
                onRetry={() => void system.refetch()}
                retrying={system.isFetching}
              />
            )
          )}

          {!failed && (
            <ServiceCards status={status} queueDepth={metrics.snapshot?.processing.queueDepth} />
          )}
          {summaryOnly && (
            <p className="text-sm text-muted-foreground">
              This server sends your account only the summary, so the Sia account and stream cache
              are not shown.
            </p>
          )}
          <div className={HEALTH_GRID.pair}>
            {!failed && !summaryOnly && <SiaAccountCard status={deployment} />}
            <StorageCheckCard />
          </div>
        </div>
      )}
    </PageContainer>
  );
}
