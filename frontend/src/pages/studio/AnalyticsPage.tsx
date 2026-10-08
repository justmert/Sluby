import { useState } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import type { VideoAssetStatus } from '@sluby/sdk';
import {
  AlertTriangle,
  type LucideIcon,
  Activity,
  BarChart3,
  Clock,
  Cpu,
  Film,
  Gauge,
  Lock,
  Play,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { lateSkeleton } from '@/components/dashboard/live';
import { StatCard } from '@/components/dashboard/StatCard';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import { AnimatedItem, AnimatedList, FadeSwap } from '@/components/motion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { usePlatformMetrics, type RatePoint } from '@/hooks/usePlatformMetrics';
import { useAssetStats, type AssetStats } from '@/hooks/useStats';
import { statusOf } from '@/lib/api-client';
import { formatBytes, formatDuration } from '@/lib/formatters';
import { usePrefersReducedMotion } from '@/lib/motion';
import type { MetricsSnapshot } from '@/lib/metrics';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const seconds = (s: number) => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
const percent = (n: number) => `${Math.round(n)}%`;
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

// 24-hour clock with seconds: samples are 10 s apart, and it stays short on a phone
const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

/** Short eased chart animations, none under reduced motion. */
function useChartMotion() {
  const reduce = usePrefersReducedMotion();
  return {
    isAnimationActive: !reduce,
    animationDuration: 300,
    animationEasing: 'ease-out',
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

// chart boxes keep these heights in every state, so nothing below moves
const SERVER_CHART = 'h-56';
const LIBRARY_CHART = 'h-48';

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

function ServerStats({ m, stagger }: { m?: MetricsSnapshot; stagger: boolean }) {
  const responses = m ? Object.values(m.delivery.requests).reduce((a, b) => a + b, 0) : 0;
  const stats: (React.ComponentProps<typeof StatCard> & { key: string })[] = [
    {
      key: 'uploads',
      longHint: true,
      icon: Upload,
      label: 'Uploads',
      value: m?.uploads.succeeded,
      hint: m ? `${m.uploads.failed} failed, ${formatBytes(m.uploads.bytes)} received` : null,
    },
    {
      key: 'processing',
      longHint: true,
      icon: Cpu,
      label: 'Processing',
      value: m && m.processing.avgSeconds,
      format: seconds,
      hint: m
        ? `average over ${plural(m.processing.completed, 'job')}, ${
            m.processing.queueDepth === null
              ? 'queue depth unknown while Redis is down'
              : `${m.processing.queueDepth} in queue`
          }`
        : null,
    },
    {
      key: 'sia',
      longHint: true,
      icon: Clock,
      label: 'Sia upload',
      value: m && m.sia.avgSeconds,
      format: seconds,
      hint: m ? `average over ${plural(m.sia.uploads, 'packed upload')}` : null,
    },
    {
      key: 'playback',
      longHint: true,
      icon: Play,
      label: 'Playback URLs',
      value: m && m.playback.public + m.playback.signed + m.playback.sia,
      hint: m ? `${m.playback.sia} direct from Sia, ${m.playback.signed} signed` : null,
    },
    {
      key: 'served',
      icon: Activity,
      label: 'Served by gateway',
      value: m?.delivery.bytes,
      format: formatBytes,
      hint: m ? plural(responses, 'response') : null,
    },
    {
      key: 'cache',
      icon: Gauge,
      label: 'Cache hit ratio',
      value: m && (m.delivery.cacheHitRatio === null ? null : m.delivery.cacheHitRatio * 100),
      format: percent,
      hint: m && m.delivery.cacheHitRatio === null ? 'no cache lookups yet' : undefined,
    },
    {
      key: 'uptime',
      icon: Clock,
      label: 'Uptime',
      // both times come from the server, so the browser clock cannot skew it
      value: m && (m.process.startedAt ? m.takenAt - m.process.startedAt : null),
      format: formatDuration,
    },
    {
      key: 'memory',
      icon: Cpu,
      label: 'Memory',
      value: m && (m.process.residentBytes || null),
      format: formatBytes,
      hint: m
        ? m.process.heapUsedBytes
          ? `${formatBytes(m.process.heapUsedBytes)} heap`
          : undefined
        : null,
    },
  ];
  return (
    <AnimatedList
      as="div"
      initial={stagger ? 'hidden' : false}
      className="grid grid-cols-2 gap-4 @3xl/analytics:grid-cols-4"
    >
      {stats.map(({ key, ...stat }) => (
        <AnimatedItem as="div" key={key} layout={false}>
          <StatCard {...stat} />
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}

function ThroughputChart({ rates }: { rates: RatePoint[] }) {
  const motion = useChartMotion();
  // the line draws in once; after that each new sample just lands
  const [drawn, setDrawn] = useState(false);
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
          isAnimationActive={motion.isAnimationActive && !drawn}
          onAnimationEnd={() => setDrawn(true)}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function ResponsesChart({ m }: { m: MetricsSnapshot }) {
  const motion = useChartMotion();
  const data = [
    { kind: 'Media ranges', count: m.delivery.requests.media },
    { kind: 'Manifests', count: m.delivery.requests.manifest },
    { kind: 'Other objects', count: m.delivery.requests.object },
  ];
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
    <div className="mt-4 grid gap-4 @3xl/analytics:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Gateway throughput</CardTitle>
          <CardDescription>Sampled every 10 seconds while this page is open</CardDescription>
        </CardHeader>
        <CardContent>
          <FadeSwap swapKey={m ? 'ready' : 'loading'}>
            {m ? (
              <ThroughputChart rates={rates} />
            ) : (
              <Skeleton className={cn(SERVER_CHART, 'w-full', lateSkeleton)} />
            )}
          </FadeSwap>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gateway responses</CardTitle>
          <CardDescription>By object kind, since the backend started</CardDescription>
        </CardHeader>
        <CardContent>
          <FadeSwap swapKey={m ? 'ready' : 'loading'}>
            {m ? (
              <ResponsesChart m={m} />
            ) : (
              <Skeleton className={cn(SERVER_CHART, 'w-full', lateSkeleton)} />
            )}
          </FadeSwap>
        </CardContent>
      </Card>
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
    return (
      <Alert className="mb-4">
        <Lock />
        <AlertTitle>Server metrics are for operators</AlertTitle>
        <AlertDescription>
          They count every account on this server together, so only operators see them. Your own
          library is below.
        </AlertDescription>
      </Alert>
    );
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
        className="mt-3"
        updatedAt={metrics.dataUpdatedAt}
        stale={metrics.isError}
        label="Metrics updated"
      />
    </>
  );
}

function LibraryChart({ stats }: { stats: AssetStats }) {
  const motion = useChartMotion();
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
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Your library</CardTitle>
        <CardDescription>Assets by status</CardDescription>
      </CardHeader>
      <CardContent>
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
            <Skeleton className={cn(LIBRARY_CHART, 'w-full', lateSkeleton)} />
          )}
        </FadeSwap>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { operator } = useSession();
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
      <div className="@container/analytics">
        <ServerSection operator={operator} />
        <LibraryCard />
      </div>
    </PageContainer>
  );
}
