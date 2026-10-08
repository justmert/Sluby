import { useState } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import type { VideoAssetStatus } from '@sluby/sdk';
import { AlertTriangle, type LucideIcon, BarChart3, Film, RotateCcw, Upload } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import {
  ChartCard,
  ChartLoading,
  OperatorsOnlyAlert,
  ServerStats,
} from '@/components/dashboard/analytics-parts';
import {
  ANALYTICS,
  LIBRARY_CHART,
  LIBRARY_COPY,
  RESPONSES_COPY,
  SERVER_CHART,
  THROUGHPUT_COPY,
} from '@/components/dashboard/dashboard-layout';
import { routeSkeletonWasVisible } from '@/components/dashboard/live';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import { FadeSwap } from '@/components/motion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { usePlatformMetrics, type RatePoint } from '@/hooks/usePlatformMetrics';
import { useAssetStats, type AssetStats } from '@/hooks/useStats';
import { statusOf } from '@/lib/api-client';
import { formatBytes } from '@/lib/formatters';
import { usePrefersReducedMotion } from '@/lib/motion';
import type { MetricsSnapshot } from '@/lib/metrics';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

// 24-hour clock with seconds: samples are 10 s apart, and it stays short on a phone
const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

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

const statusConfig = {
  count: { label: 'Assets', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const requestConfig = {
  count: { label: 'Responses', color: 'var(--chart-3)' },
} satisfies ChartConfig;

// the same words and colors as the status badges on every other page
const STATUS_BARS: { status: VideoAssetStatus; label: string; color: string }[] = [
  { status: 'created', label: 'Created', color: 'var(--muted-foreground)' },
  { status: 'uploading', label: 'Uploading', color: 'var(--warning)' },
  { status: 'processing', label: 'Processing', color: 'var(--warning)' },
  { status: 'ready', label: 'Ready', color: 'var(--success)' },
  { status: 'failed', label: 'Failed', color: 'var(--destructive)' },
];

function ChartBox({ className, children }: { className: string; children?: React.ReactNode }) {
  return <div className={cn('grid w-full place-items-center', className)}>{children}</div>;
}

function ChartEmpty({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Empty className="border-0 p-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {children}
      </EmptyHeader>
    </Empty>
  );
}

function ThroughputChart({ rates }: { rates: RatePoint[] }) {
  // the line draws in once; after that each new sample just lands, since a
  // sliding window morphing point by point reads as the data wobbling
  const motion = useChartMotion('drawn');
  // a line needs two rates; one alone is a dot on a made-up scale
  if (rates.length < 2) {
    return (
      <ChartBox className={SERVER_CHART}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden="true" />
          Collecting samples
        </p>
      </ChartBox>
    );
  }
  return (
    <ChartContainer config={rateConfig} className={cn(SERVER_CHART, 'aspect-auto w-full')}>
      <AreaChart data={rates} margin={{ left: 0, right: 8, top: 8 }}>
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
          tickFormatter={(v: number) => `${formatBytes(v)}/s`}
          tickLine={false}
          axisLine={false}
          width={72}
          fontSize={11}
          // an idle gateway gets a small real scale instead of 0 to 4 bytes
          domain={[0, (max: number) => Math.max(max, 1000)]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => clock((p?.[0]?.payload as RatePoint).at)}
              formatter={(v) => `${formatBytes(Number(v))}/s`}
            />
          }
        />
        <Area
          dataKey="bytesPerSecond"
          type="monotone"
          fill="var(--color-bytesPerSecond)"
          stroke="var(--color-bytesPerSecond)"
          fillOpacity={0.2}
          {...motion}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function ResponsesChart({ m }: { m: MetricsSnapshot }) {
  const data = [
    { kind: 'Media ranges', count: m.delivery.requests.media },
    { kind: 'Manifests', count: m.delivery.requests.manifest },
    { kind: 'Other objects', count: m.delivery.requests.object },
  ];
  const motion = useChartMotion(data.map((d) => d.count).join());
  if (data.every((d) => d.count === 0)) {
    return (
      <ChartBox className={SERVER_CHART}>
        <ChartEmpty icon={BarChart3} title="No gateway responses yet">
          <EmptyDescription>Videos played through the gateway show up here.</EmptyDescription>
        </ChartEmpty>
      </ChartBox>
    );
  }
  return (
    <ChartContainer config={requestConfig} className={cn(SERVER_CHART, 'aspect-auto w-full')}>
      {/* sideways bars keep the three names readable on a phone */}
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
        <CartesianGrid horizontal={false} />
        <YAxis
          type="category"
          dataKey="kind"
          tickLine={false}
          axisLine={false}
          interval={0}
          fontSize={11}
          width={88}
        />
        <XAxis
          type="number"
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          fontSize={11}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} {...motion} />
      </BarChart>
    </ChartContainer>
  );
}

function ServerCharts({ m, rates }: { m?: MetricsSnapshot; rates: RatePoint[] }) {
  return (
    <div className={ANALYTICS.charts}>
      <ChartCard {...THROUGHPUT_COPY}>
        <FadeSwap swapKey={m ? 'ready' : 'loading'}>
          {m ? <ThroughputChart rates={rates} /> : <ChartLoading height={SERVER_CHART} />}
        </FadeSwap>
      </ChartCard>
      <ChartCard {...RESPONSES_COPY}>
        <FadeSwap swapKey={m ? 'ready' : 'loading'}>
          {m ? <ResponsesChart m={m} /> : <ChartLoading height={SERVER_CHART} />}
        </FadeSwap>
      </ChartCard>
    </div>
  );
}

function RetryButton({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
      {retrying ? <Spinner aria-hidden="true" /> : <RotateCcw />}
      Try again
    </Button>
  );
}

function ServerSection({ operator }: { operator: boolean }) {
  const metrics = usePlatformMetrics(operator);
  const m = metrics.snapshot;
  // cards stagger in when the page waits for its first reading, not when
  // it comes back to cached figures
  const [stagger] = useState(() => m === undefined);
  const retry = () => void metrics.refetch();

  if (!operator || statusOf(metrics.error) === 403) {
    return <OperatorsOnlyAlert />;
  }
  if (!m && metrics.isError) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertTriangle />
        <AlertTitle>Could not read metrics</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <p>{metrics.error.message}</p>
          <RetryButton onRetry={retry} retrying={metrics.isFetching} />
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <>
      {metrics.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle />
          <AlertTitle>Metrics stopped updating</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>{metrics.error?.message}. The figures below are from the last good reading.</p>
            <RetryButton onRetry={retry} retrying={metrics.isFetching} />
          </AlertDescription>
        </Alert>
      )}
      <ServerStats m={m} stagger={stagger} />
      <ServerCharts m={m} rates={metrics.rates} />
      <UpdatedAgo
        className={ANALYTICS.updated}
        updatedAt={metrics.dataUpdatedAt}
        stale={metrics.isError}
        label="Metrics updated"
      />
    </>
  );
}

function LibraryChart({ stats }: { stats: AssetStats }) {
  const motion = useChartMotion(STATUS_BARS.map((b) => stats.by_status[b.status]).join());
  if (stats.total === 0) {
    return (
      <ChartBox className={LIBRARY_CHART}>
        <ChartEmpty icon={Film} title="No videos yet">
          <EmptyDescription>Upload a video to see it here by status.</EmptyDescription>
          <EmptyContent>
            <Button size="sm" asChild>
              <Link to="/studio/upload">
                <Upload />
                Upload video
              </Link>
            </Button>
          </EmptyContent>
        </ChartEmpty>
      </ChartBox>
    );
  }
  const data = STATUS_BARS.map((b) => ({ ...b, count: stats.by_status[b.status] }));
  return (
    <ChartContainer config={statusConfig} className={cn(LIBRARY_CHART, 'aspect-auto w-full')}>
      {/* bars run sideways so the five status names stack down the left and
          stay readable on a phone, where they ran together along the bottom */}
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
        <CartesianGrid horizontal={false} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          fontSize={11}
          width={80}
        />
        <XAxis
          type="number"
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          fontSize={11}
        />
        <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey="count" radius={4} {...motion}>
          {data.map((d) => (
            <Cell key={d.status} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function LibraryCard() {
  const stats = useAssetStats();
  const state = stats.data ? 'ready' : stats.isError ? 'error' : 'loading';
  return (
    <ChartCard {...LIBRARY_COPY} className={ANALYTICS.library}>
      <FadeSwap swapKey={state}>
        {stats.data ? (
          <LibraryChart stats={stats.data} />
        ) : stats.isError ? (
          <ChartBox className={LIBRARY_CHART}>
            <div role="alert" className="flex flex-col items-center gap-3 text-center text-sm">
              <p className="text-destructive">
                Could not load your library totals: {stats.error.message}
              </p>
              <RetryButton onRetry={() => void stats.refetch()} retrying={stats.isFetching} />
            </div>
          </ChartBox>
        ) : (
          <ChartLoading height={LIBRARY_CHART} />
        )}
      </FadeSwap>
    </ChartCard>
  );
}

export default function AnalyticsPage() {
  const { operator } = useSession();
  // taking over from the route skeleton: keep its placeholders on screen
  const [instant] = useState(routeSkeletonWasVisible);
  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description={
          operator
            ? 'Live counters from this backend process since it started, plus your library mix'
            : 'Your library mix'
        }
      />
      <div data-instant-skeletons={instant || undefined}>
        <ServerSection operator={operator} />
        <LibraryCard />
      </div>
    </PageContainer>
  );
}
