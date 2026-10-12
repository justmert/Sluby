import { useState } from 'react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { ServerStats } from '@/components/dashboard/analytics-parts';
import {
  ANALYTICS,
  RESPONSES_COPY,
  SERVER_CHART,
  THROUGHPUT_COPY,
} from '@/components/dashboard/dashboard-layout';
import { routeSkeletonWasVisible } from '@/components/dashboard/live';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import { BytesChart, BytesChartLoading } from '@/components/deployment/BytesChart';
import { Panel } from '@/components/deployment/parts';
import { RequestsBars } from '@/components/deployment/RequestsBars';
import { FadeSwap } from '@/components/motion';
import { InlineError } from '@/components/shared/InlineError';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlatformMetrics } from '@/hooks/usePlatformMetrics';
import type { MetricsSnapshot } from '@/lib/metrics';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { PAGE_HEADS } from '@/components/layout/page-heads';

// what the updated dot watches: the counters, not uptime or memory, which move on every reading
const countersOf = (m: MetricsSnapshot) =>
  JSON.stringify([m.uploads, m.processing, m.sia, m.delivery, m.playback]);

const Note = ({ children }: { children: React.ReactNode }) => (
  <span className="text-muted-foreground">{children}</span>
);

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
            <div className={ANALYTICS.charts}>
              <Panel
                id="metrics-throughput"
                title={THROUGHPUT_COPY.title}
                note={<Note>{THROUGHPUT_COPY.description}</Note>}
              >
                <FadeSwap swapKey={m ? 'ready' : 'loading'}>
                  {m ? (
                    <BytesChart rates={metrics.rates} height={SERVER_CHART} />
                  ) : (
                    <BytesChartLoading height={SERVER_CHART} />
                  )}
                </FadeSwap>
              </Panel>
              <Panel
                id="metrics-requests"
                title={RESPONSES_COPY.title}
                note={<Note>{RESPONSES_COPY.description}</Note>}
              >
                <FadeSwap swapKey={m ? 'ready' : 'loading'}>
                  {m ? (
                    <RequestsBars m={m} height={SERVER_CHART} />
                  ) : (
                    <Skeleton className={cn('w-full', SERVER_CHART, lateReveal)} />
                  )}
                </FadeSwap>
              </Panel>
            </div>
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
