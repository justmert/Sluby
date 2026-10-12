// the metrics page's two chart cards and its loading draw, shared by the page
// and by the route skeleton, so the skeleton shown while the page's code
// loads is the one the page shows while its data loads
import { ServerStats } from '@/components/dashboard/analytics-parts';
import {
  ANALYTICS,
  RESPONSES_COPY,
  SERVER_CHART,
  THROUGHPUT_COPY,
} from '@/components/dashboard/dashboard-layout';
import { FadeSwap } from '@/components/motion';
import { Skeleton } from '@/components/ui/skeleton';
import type { RatePoint } from '@/hooks/usePlatformMetrics';
import type { MetricsSnapshot } from '@/lib/metrics';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BytesChart, BytesChartLoading } from './BytesChart';
import { Panel } from './parts';
import { RequestsBars } from './RequestsBars';

const Note = ({ children }: { children: React.ReactNode }) => (
  <span className="text-muted-foreground">{children}</span>
);

/** Throughput and requests; `m` undefined while the first reading loads. */
export function MetricsCharts({ m, rates = [] }: { m?: MetricsSnapshot; rates?: RatePoint[] }) {
  return (
    <div className={ANALYTICS.charts}>
      <Panel
        id="metrics-throughput"
        title={THROUGHPUT_COPY.title}
        note={<Note>{THROUGHPUT_COPY.description}</Note>}
      >
        <FadeSwap swapKey={m ? 'ready' : 'loading'}>
          {m ? (
            <BytesChart rates={rates} height={SERVER_CHART} />
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
  );
}

/** Metrics as it first draws, before any answer, under the page header. */
export function MetricsLoading() {
  return (
    <>
      <ServerStats />
      <MetricsCharts />
      <p aria-hidden="true" className={cn('h-4', ANALYTICS.updated)} />
    </>
  );
}
