import { useState } from 'react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { ServerStats } from '@/components/dashboard/analytics-parts';
import { ANALYTICS } from '@/components/dashboard/dashboard-layout';
import { routeSkeletonWasVisible } from '@/components/dashboard/live';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import { MetricsCharts } from '@/components/deployment/MetricsCharts';
import { InlineError } from '@/components/shared/InlineError';
import { usePlatformMetrics } from '@/hooks/usePlatformMetrics';
import type { MetricsSnapshot } from '@/lib/metrics';
import { PAGE_HEADS } from '@/components/layout/page-heads';

// what the updated dot watches: the counters, not uptime or memory, which move on every reading
const countersOf = (m: MetricsSnapshot) =>
  JSON.stringify([m.uploads, m.processing, m.sia, m.delivery, m.playback]);

export default function MetricsPage() {
  // taking over from the route skeleton: keep its placeholders on screen
  const [instant] = useState(routeSkeletonWasVisible);
  const metrics = usePlatformMetrics(true);
  const m = metrics.snapshot;
  // cards stagger in when the page waits for its first reading, not when
  // it comes back to cached figures
  const [stagger] = useState(() => m === undefined);
  const retry = () => void metrics.refetch();
  const failed = !m && metrics.isError;

  return (
    <PageContainer>
      <PageHeader {...PAGE_HEADS.metrics} className="mb-5" />
      <div data-instant-skeletons={instant || undefined}>
        {failed ? (
          <InlineError
            what="server metrics"
            error={metrics.error}
            onRetry={retry}
            retrying={metrics.isFetching}
          />
        ) : (
          <>
            {metrics.isError && (
              <InlineError
                title="Metrics are out of date"
                error={metrics.error}
                note="Showing the last figures that loaded."
                onRetry={retry}
                retrying={metrics.isFetching}
                className="mb-4"
              />
            )}
            <ServerStats m={m} stagger={stagger} />
            <MetricsCharts m={m} rates={metrics.rates} />
            <UpdatedAgo
              className={ANALYTICS.updated}
              updatedAt={metrics.dataUpdatedAt}
              data={m && countersOf(m)}
              stale={metrics.isError}
              label="Metrics updated"
            />
          </>
        )}
      </div>
    </PageContainer>
  );
}
