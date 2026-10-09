import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import { ServicesCard } from '@/components/deployment/ServicesCard';
import { SiaAccountCard } from '@/components/deployment/SiaAccountCard';
import { StorageCheckCard } from '@/components/deployment/StorageCheckCard';
import { StreamCacheCard } from '@/components/deployment/StreamCacheCard';
import { InlineError } from '@/components/shared/InlineError';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { healthOf, useSystemStatus } from '@/hooks/useSystemStatus';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

const HEALTH = {
  top: 'grid gap-4 @3xl/page:grid-cols-2',
  row: 'mt-4',
} as const;

// operators only: App.tsx wraps the route in OperatorOnly
export default function HealthPage() {
  const system = useSystemStatus({ poll: true });
  const status = system.data;
  const deployment = status?.scope === 'deployment' ? status : undefined;
  // the server only sends the summary to an account that is not the platform identity
  const summaryOnly = status?.scope === 'account';
  const failed = system.isError && !status;

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
        <div className={HEALTH.top}>
          <ServicesCard status={status} />
          {summaryOnly ? null : <SiaAccountCard status={deployment} />}
        </div>
      )}
      {summaryOnly && (
        <p className="mt-4 text-sm text-muted-foreground">
          This server sends your account only the summary, so the Sia account and stream cache are
          not shown.
        </p>
      )}
      <div className={HEALTH.row}>
        <StorageCheckCard />
      </div>
      {!failed && !summaryOnly && (
        <div className={HEALTH.row}>
          <StreamCacheCard status={deployment} />
        </div>
      )}
    </PageContainer>
  );
}
