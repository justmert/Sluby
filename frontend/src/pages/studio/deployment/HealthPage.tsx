import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import { ServicesCard } from '@/components/deployment/ServicesCard';
import { SiaAccountCard } from '@/components/deployment/SiaAccountCard';
import { StorageCheckCard } from '@/components/deployment/StorageCheckCard';
import { StreamCacheCard } from '@/components/deployment/StreamCacheCard';
import { InlineError } from '@/components/shared/InlineError';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { HEALTH_GRID } from '@/components/deployment/health';
import { HealthLoading } from '@/components/deployment/HealthLoading';
import { Skeleton } from '@/components/ui/skeleton';
import { useReconciliation } from '@/hooks/useStats';
import { healthOf, useSystemStatus } from '@/hooks/useSystemStatus';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

// how long the page holds its first draw for the status and the check, so
// the cards land at once instead of growing one by one
const FIRST_DRAW_WAIT_MS = 1_500;

// operators only: App.tsx wraps the route in OperatorOnly
export default function HealthPage() {
  const system = useSystemStatus({ poll: true });
  const status = system.data;
  const deployment = status?.scope === 'deployment' ? status : undefined;
  // the server only sends the summary to an account that is not the platform identity
  const summaryOnly = status?.scope === 'account';
  const failed = system.isError && !status;
  const run = useReconciliation();
  const settled = !system.isPending && !run.isPending;
  const [cached] = useState(settled);
  const [waited, setWaited] = useState(cached);
  useEffect(() => {
    if (waited) return;
    const id = window.setTimeout(() => setWaited(true), FIRST_DRAW_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [waited]);
  const ready = settled || waited;

  return (
    <PageContainer>
      <PageHeader
        title="Health"
        description="Whether this server and its Sia storage are working"
        meta={
          status ? (
            <>
              <StatusBadge kind="health" status={healthOf(status)} live />
              <UpdatedAgo
                updatedAt={system.dataUpdatedAt}
                data={status}
                stale={system.isError}
                label="Checked"
              />
            </>
          ) : failed ? null : (
            <Skeleton className={cn('h-5.5 w-28 rounded-full', lateReveal)} />
          )
        }
      />

      {!ready ? (
        <HealthLoading />
      ) : (
        <>
          {failed ? (
            <InlineError
              what="this server's status"
              error={system.error}
              onRetry={() => void system.refetch()}
              retrying={system.isFetching}
              className="mb-4"
            />
          ) : (
            system.isError && (
              <InlineError
                title="Status is out of date"
                error={system.error}
                note="Showing the last figures that loaded."
                onRetry={() => void system.refetch()}
                retrying={system.isFetching}
                className="mb-4"
              />
            )
          )}

          {!failed && (
            <div className={HEALTH_GRID.top}>
              <ServicesCard status={status} />
              {summaryOnly ? null : <SiaAccountCard status={deployment} />}
            </div>
          )}
          {summaryOnly && (
            <p className="mt-4 text-sm text-muted-foreground">
              This server sends your account only the summary, so the Sia account and stream cache
              are not shown.
            </p>
          )}
          <div className={HEALTH_GRID.row}>
            <StorageCheckCard />
          </div>
          {!failed && !summaryOnly && (
            <div className={HEALTH_GRID.row}>
              <StreamCacheCard status={deployment} />
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
