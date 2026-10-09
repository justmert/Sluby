import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import {
  ChartCard,
  ChartLoading,
  ServerStats,
  ThroughputFigureSlot,
} from '@/components/dashboard/analytics-parts';
import {
  ANALYTICS,
  EMPTY_CHART,
  RESPONSES_COPY,
  SERVER_CHART,
  THROUGHPUT_COPY,
} from '@/components/dashboard/dashboard-layout';
import { routeSkeletonWasVisible } from '@/components/dashboard/live';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import { FadeSwap } from '@/components/motion';
import { EmptyState } from '@/components/shared/EmptyState';
import { InlineError } from '@/components/shared/InlineError';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Spinner } from '@/components/ui/spinner';
import { usePlatformMetrics, type RatePoint } from '@/hooks/usePlatformMetrics';
import { formatBytes, formatCount, plural } from '@/lib/formatters';
import { usePrefersReducedMotion } from '@/lib/motion';
import type { MetricsSnapshot } from '@/lib/metrics';
import { cn } from '@/lib/utils';

// the reader's own clock format, with seconds: samples are 10 s apart
const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const rate = (bytes: number) => `${formatBytes(bytes)}/s`;

/**
 * Short eased chart animation that runs when the values change, never for a
 * resize: recharts redraws on every container size change, and bars sliding
 * about while the window moves is noise. Off under reduced motion.
 */
function useChartMotion(values: string) {
  const reduce = usePrefersReducedMotion();
  // the values the last finished animation drew
  const [settled, setSettled] = useState<string | null>(null);
  return {
    isAnimationActive: !reduce && settled !== values,
    animationDuration: 300,
    animationEasing: 'ease-out',
    onAnimationEnd: () => setSettled(values),
  } as const;
}

const rateConfig = {
  bytesPerSecond: { label: 'Throughput', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const requestConfig = {
  count: { label: 'Requests', color: 'var(--chart-3)' },
} satisfies ChartConfig;

/** A chart with nothing to draw yet: a smaller box, so an empty chart is not the loudest thing. */
function ChartPending({ children }: { children: React.ReactNode }) {
  return <div className={cn('grid w-full place-items-center', EMPTY_CHART)}>{children}</div>;
}

function throughputSummary(rates: RatePoint[]) {
  if (rates.length === 0) return null;
  const now = rates[rates.length - 1].bytesPerSecond;
  const peak = Math.max(...rates.map((r) => r.bytesPerSecond));
  return { now, peak };
}

function ThroughputChart({ rates }: { rates: RatePoint[] }) {
  // the line draws in once; after that each new sample just lands, since a
  // sliding window morphing point by point reads as the data wobbling
  const motion = useChartMotion('drawn');
  // a line needs two rates; one alone is a dot on a made-up scale. the
  // first two come within seconds, so this is loading, not an empty chart:
  // it keeps the chart's height, and nothing grows when the line lands
  if (rates.length < 2) {
    return (
      <div className={cn('grid w-full place-items-center', SERVER_CHART)}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden="true" />
          Collecting samples
        </p>
      </div>
    );
  }
  const { now, peak } = throughputSummary(rates)!;
  const seconds = Math.round((rates[rates.length - 1].at - rates[0].at) / 1000);
  const span =
    seconds < 60 ? plural(seconds, 'second') : plural(Math.round(seconds / 60), 'minute');
  return (
    <ChartContainer config={rateConfig} className={cn(SERVER_CHART, 'aspect-auto w-full')}>
      <AreaChart
        data={rates}
        margin={{ left: 0, right: 8, top: 8 }}
        accessibilityLayer={false}
        role="img"
        title={`Streaming throughput, now ${rate(now)}, peak ${rate(peak)} over the last ${span}`}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="at"
          tickFormatter={clock}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          fontSize={11}
        />
        <YAxis
          tickFormatter={rate}
          tickLine={false}
          axisLine={false}
          width={72}
          fontSize={11}
          // an idle server gets a small real scale instead of 0 to 4 bytes
          domain={[0, (max: number) => Math.max(max, 1000)]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => clock((p?.[0]?.payload as RatePoint).at)}
              formatter={(v) => rate(Number(v))}
            />
          }
        />
        <Area
          dataKey="bytesPerSecond"
          type="monotone"
          fill="var(--color-bytesPerSecond)"
          stroke="var(--color-bytesPerSecond)"
          strokeWidth={2}
          fillOpacity={0.12}
          {...motion}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function RequestsChart({ m }: { m: MetricsSnapshot }) {
  const data = [
    { kind: 'Video segments', count: m.delivery.requests.media },
    { kind: 'Playlists', count: m.delivery.requests.manifest },
    { kind: 'Other files', count: m.delivery.requests.object },
  ];
  const motion = useChartMotion(data.map((d) => d.count).join());
  if (data.every((d) => d.count === 0)) {
    return (
      <ChartPending>
        <EmptyState
          icon={BarChart3}
          title="Nothing streamed yet"
          description="Requests appear here when videos play through this server."
          className="py-4"
        />
      </ChartPending>
    );
  }
  return (
    <ChartContainer config={requestConfig} className={cn(SERVER_CHART, 'aspect-auto w-full')}>
      {/* sideways bars keep the three names readable on a phone */}
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 0, right: 48 }}
        accessibilityLayer={false}
        role="img"
        title={`Streaming requests: ${data.map((d) => `${d.kind} ${formatCount(d.count)}`).join(', ')}`}
      >
        <CartesianGrid horizontal={false} />
        <YAxis
          type="category"
          dataKey="kind"
          tickLine={false}
          axisLine={false}
          interval={0}
          fontSize={11}
          width={96}
        />
        <XAxis
          type="number"
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          fontSize={11}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} maxBarSize={24} {...motion}>
          {/* the numbers on the bars, so nobody needs the tooltip to read them */}
          <LabelList
            dataKey="count"
            position="right"
            className="fill-foreground"
            fontSize={11}
            formatter={(v: unknown) => formatCount(Number(v))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function ThroughputFigure({ rates }: { rates: RatePoint[] }) {
  // with fewer than two rates the chart still says it is collecting samples
  const s = rates.length >= 2 ? throughputSummary(rates) : null;
  // the figure's line waits empty, so the chart below does not move down
  if (!s) return <ThroughputFigureSlot />;
  return (
    <p data-slot="throughput-figure" className="mb-3 text-sm text-muted-foreground tabular-nums">
      Now <span className="font-medium text-foreground">{rate(s.now)}</span>, peak {rate(s.peak)}
    </p>
  );
}

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
      <PageHeader title="Metrics" description="Server activity since it last started" />
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
              <ChartCard {...THROUGHPUT_COPY}>
                {m ? <ThroughputFigure rates={metrics.rates} /> : <ThroughputFigureSlot />}
                <FadeSwap swapKey={m ? 'ready' : 'loading'}>
                  {m ? <ThroughputChart rates={metrics.rates} /> : <ChartLoading />}
                </FadeSwap>
              </ChartCard>
              <ChartCard {...RESPONSES_COPY}>
                <FadeSwap swapKey={m ? 'ready' : 'loading'}>
                  {m ? <RequestsChart m={m} /> : <ChartLoading />}
                </FadeSwap>
              </ChartCard>
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
