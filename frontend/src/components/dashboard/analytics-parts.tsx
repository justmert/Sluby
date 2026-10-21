// metrics cards and loading states, shared by the page and by the route
// skeleton, so the skeleton shown while the page's code loads is the one the
// page shows while its data loads
import { Activity, Gauge, Play } from 'lucide-react';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { StatCard } from '@/components/shared/StatCard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, formatCount, plural } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { formatSpan, type MetricsSnapshot } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { ANALYTICS, RESPONSES_COPY, SERVER_CHART, THROUGHPUT_COPY } from './dashboard-layout';
import { lateSkeleton } from './live';

const percent = (n: number) => `${Math.round(n)}%`;

/** A chart card: title, description, an optional figure on the right, then the chart. */
export function ChartCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {action && <CardAction className="text-right">{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Where the throughput chart's now and peak line goes, held empty until there is one. */
export function ThroughputFigureSlot() {
  return <div data-slot="throughput-figure" aria-hidden="true" className="mb-3 h-5" />;
}

/** A chart's box while it loads, at the chart's own height. */
export function ChartLoading({ height = SERVER_CHART }: { height?: string }) {
  return <Skeleton className={cn(height, 'w-full', lateSkeleton)} />;
}

type Stat = React.ComponentProps<typeof StatCard> & { key: string };

/** The eight server counters; `m` undefined while loading. */
function serverStats(m?: MetricsSnapshot): Stat[] {
  const requests = m ? Object.values(m.delivery.requests).reduce((a, b) => a + b, 0) : 0;
  return [
    {
      key: 'uploads',
      longHint: true,
      icon: Icons.upload,
      label: 'Uploads',
      value: m?.uploads.succeeded,
      hint: m
        ? `${formatCount(m.uploads.failed)} failed, ${formatBytes(m.uploads.bytes)} received`
        : null,
    },
    {
      key: 'processing',
      longHint: true,
      icon: Icons.processing,
      label: 'Processing time',
      value: m && m.processing.avgSeconds,
      format: formatSpan,
      emptyReason: 'No video processed yet',
      hint: m
        ? `Average of ${plural(m.processing.completed, 'job')}, ${
            m.processing.queueDepth === null
              ? 'queue length unknown (job queue is down)'
              : `${formatCount(m.processing.queueDepth)} in queue`
          }`
        : null,
    },
    {
      key: 'sia',
      longHint: true,
      icon: Icons.storeOnSia,
      label: 'Sia upload time',
      value: m && m.sia.avgSeconds,
      format: formatSpan,
      emptyReason: 'Nothing stored on Sia yet',
      hint: m ? `Average of ${plural(m.sia.uploads, 'upload')}` : null,
    },
    {
      key: 'playback',
      longHint: true,
      icon: Play,
      label: 'Playback URLs',
      value: m && m.playback.public + m.playback.private + m.playback.signed + m.playback.sia,
      hint: m
        ? `${formatCount(m.playback.sia)} direct from Sia, ${formatCount(m.playback.signed)} signed`
        : null,
    },
    {
      key: 'served',
      icon: Activity,
      label: 'Streamed by this server',
      value: m?.delivery.bytes,
      format: formatBytes,
      hint: m ? plural(requests, 'request') : null,
    },
    {
      key: 'cache',
      icon: Gauge,
      label: 'Cache hit ratio',
      value: m && (m.delivery.cacheHitRatio === null ? null : m.delivery.cacheHitRatio * 100),
      format: percent,
      emptyReason: 'No lookups yet',
      hint: m
        ? m.delivery.cacheHitRatio === null
          ? 'No lookups yet'
          : 'Stream cache lookups'
        : null,
    },
    {
      key: 'uptime',
      icon: Icons.uptime,
      label: 'Uptime',
      // both times come from the server, so the browser clock cannot skew it
      value: m && (m.process.startedAt ? (m.takenAt - m.process.startedAt) / 1000 : null),
      format: formatSpan,
      hint: m ? 'Since the server last started' : null,
    },
    {
      key: 'memory',
      icon: Icons.memory,
      label: 'Memory',
      value: m && (m.process.residentBytes || null),
      format: formatBytes,
      hint: m
        ? m.process.heapUsedBytes
          ? `${formatBytes(m.process.heapUsedBytes)} heap`
          : 'Heap not reported'
        : null,
    },
  ];
}

export function ServerStats({ m, stagger = false }: { m?: MetricsSnapshot; stagger?: boolean }) {
  return (
    <AnimatedList
      as="div"
      role="list"
      aria-label="Server counters"
      initial={stagger ? 'hidden' : false}
      className={ANALYTICS.stats}
    >
      {serverStats(m).map(({ key, ...stat }) => (
        <AnimatedItem as="div" role="listitem" key={key} layout={false}>
          <StatCard {...stat} />
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}

/**
 * Metrics as it first draws, before any answer: what the route skeleton
 * shows while the page's code loads, built from the pieces the page shows
 * while its data loads. Members never reach the page (AdminOnly).
 */
export function AnalyticsLoading(_: { admin?: boolean }) {
  return (
    <>
      <ServerStats />
      <div className={ANALYTICS.charts}>
        <ChartCard {...THROUGHPUT_COPY}>
          <ThroughputFigureSlot />
          <ChartLoading />
        </ChartCard>
        <ChartCard {...RESPONSES_COPY}>
          <ChartLoading />
        </ChartCard>
      </div>
      <p aria-hidden="true" className={cn('h-4', ANALYTICS.updated)} />
    </>
  );
}
