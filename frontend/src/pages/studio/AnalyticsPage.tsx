import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  type LucideIcon,
  Activity,
  Clock,
  Cpu,
  Gauge,
  Lock,
  Play,
  Upload,
} from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlatformMetrics } from '@/hooks/usePlatformMetrics';
import { useAssetStats } from '@/hooks/useStats';
import { statusOf } from '@/lib/api-client';
import { formatBytes, formatDuration } from '@/lib/formatters';
import type { MetricsSnapshot } from '@/lib/metrics';
import { useSession } from '@/lib/session';

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

const seconds = (s: number | null) =>
  s === null ? 'n/a' : `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;

const rateConfig = {
  bytesPerSecond: { label: 'Bytes / s', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const statusConfig = {
  count: { label: 'Assets', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const requestConfig = {
  count: { label: 'Requests', color: 'var(--chart-3)' },
} satisfies ChartConfig;

function ServerStats({ m }: { m: MetricsSnapshot }) {
  const responses = Object.values(m.delivery.requests).reduce((a, b) => a + b, 0);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat
        icon={Upload}
        label="Uploads"
        value={m.uploads.succeeded.toLocaleString()}
        hint={`${m.uploads.failed} failed, ${formatBytes(m.uploads.bytes)} received`}
      />
      <Stat
        icon={Cpu}
        label="Processing"
        value={seconds(m.processing.avgSeconds)}
        hint={`average over ${m.processing.completed} job${m.processing.completed === 1 ? '' : 's'}, ${m.processing.queueDepth === null ? 'queue depth unknown while Redis is down' : `${m.processing.queueDepth} in queue`}`}
      />
      <Stat
        icon={Clock}
        label="Sia upload"
        value={seconds(m.sia.avgSeconds)}
        hint={`average over ${m.sia.uploads} packed upload${m.sia.uploads === 1 ? '' : 's'}`}
      />
      <Stat
        icon={Play}
        label="Playback URLs"
        value={(m.playback.public + m.playback.signed + m.playback.sia).toLocaleString()}
        hint={`${m.playback.sia} direct from Sia, ${m.playback.signed} signed`}
      />
      <Stat
        icon={Activity}
        label="Served by gateway"
        value={formatBytes(m.delivery.bytes)}
        hint={`${responses.toLocaleString()} response${responses === 1 ? '' : 's'}`}
      />
      <Stat
        icon={Gauge}
        label="Cache hit ratio"
        value={
          m.delivery.cacheHitRatio === null
            ? 'n/a'
            : `${Math.round(m.delivery.cacheHitRatio * 100)}%`
        }
        hint={m.delivery.cacheHitRatio === null ? 'no cache lookups yet' : undefined}
      />
      <Stat
        icon={Clock}
        label="Uptime"
        // both times come from the server, so the browser clock cannot skew it
        value={m.process.startedAt ? formatDuration(m.takenAt - m.process.startedAt) : 'n/a'}
      />
      <Stat
        icon={Cpu}
        label="Memory"
        value={m.process.residentBytes ? formatBytes(m.process.residentBytes) : 'n/a'}
        hint={m.process.heapUsedBytes ? `${formatBytes(m.process.heapUsedBytes)} heap` : undefined}
      />
    </div>
  );
}

function ServerCharts({ m, rates }: { m: MetricsSnapshot; rates: { at: number }[] }) {
  const requestData = [
    { kind: 'Media ranges', count: m.delivery.requests.media },
    { kind: 'Manifests', count: m.delivery.requests.manifest },
    { kind: 'Other objects', count: m.delivery.requests.object },
  ];
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Gateway throughput</CardTitle>
          <CardDescription>Sampled every 10 seconds while this page is open</CardDescription>
        </CardHeader>
        <CardContent>
          {rates.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Collecting samples...</p>
          ) : (
            <ChartContainer config={rateConfig} className="h-56 w-full">
              <AreaChart data={rates}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="at"
                  tickFormatter={(t: number) => new Date(t).toLocaleTimeString()}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                />
                <YAxis
                  tickFormatter={(v: number) => formatBytes(v)}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, p) =>
                        new Date((p?.[0]?.payload as { at: number }).at).toLocaleTimeString()
                      }
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
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gateway responses</CardTitle>
          <CardDescription>By object kind, since the backend started</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={requestConfig} className="h-56 w-full">
            <BarChart data={requestData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="kind" tickLine={false} axisLine={false} interval={0} fontSize={11} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function ServerSection({ operator }: { operator: boolean }) {
  const metrics = usePlatformMetrics(operator);
  const m = metrics.snapshot;

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
        <AlertDescription>{metrics.error.message}</AlertDescription>
      </Alert>
    );
  }
  if (!m) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  return (
    <>
      {metrics.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle />
          <AlertTitle>Metrics stopped updating</AlertTitle>
          <AlertDescription>
            <p>{metrics.error?.message}</p>
            <p>The figures below are from the last good reading.</p>
          </AlertDescription>
        </Alert>
      )}
      <ServerStats m={m} />
      <ServerCharts m={m} rates={metrics.rates} />
    </>
  );
}

function LibraryCard() {
  const stats = useAssetStats();
  const statusData = stats.data
    ? Object.entries(stats.data.by_status).map(([status, count]) => ({ status, count }))
    : [];
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Your library</CardTitle>
        <CardDescription>Assets by status</CardDescription>
      </CardHeader>
      <CardContent>
        {stats.isPending ? (
          <Skeleton className="h-48" />
        ) : stats.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load your library totals: {stats.error.message}
          </p>
        ) : (
          <ChartContainer config={statusConfig} className="h-48 w-full">
            <BarChart data={statusData}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="status"
                tickLine={false}
                axisLine={false}
                interval={0}
                fontSize={11}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
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
      <ServerSection operator={operator} />
      <LibraryCard />
    </PageContainer>
  );
}
