import { Link } from 'react-router';
import { InlineError } from '@/components/shared/InlineError';
import type { usePlatformMetrics } from '@/hooks/usePlatformMetrics';
import { ROUTES } from '@/lib/constants';
import { BytesChart, BytesChartLoading } from './BytesChart';
import { sampleSpan } from './health';
import { ACCENT_LINK, Panel } from './parts';

type Metrics = ReturnType<typeof usePlatformMetrics>;

/**
 * Bytes this server streamed, from the metrics samples taken while the
 * Studio watches: the server keeps no history, so the span grows from the
 * moment a deployment page opened, up to the samples the metrics hook keeps.
 */
export function BytesStreamedCard({ metrics }: { metrics?: Metrics }) {
  const span = metrics ? sampleSpan(metrics.rates) : null;
  const failed = metrics && !metrics.snapshot && metrics.isError;
  return (
    <Panel
      id="health-bytes-streamed"
      title="Bytes streamed"
      note={
        <span className="text-muted-foreground">
          {span ? `Last ${span}` : 'Sampled every 10 s while this page is open'}
        </span>
      }
      action={
        <Link to={ROUTES.METRICS} className={ACCENT_LINK}>
          Open metrics
        </Link>
      }
    >
      {failed ? (
        <InlineError
          what="the streaming figures"
          error={metrics.error}
          onRetry={() => void metrics.refetch()}
          retrying={metrics.isFetching}
        />
      ) : !metrics?.snapshot ? (
        <BytesChartLoading />
      ) : (
        <BytesChart rates={metrics.rates} />
      )}
    </Panel>
  );
}
