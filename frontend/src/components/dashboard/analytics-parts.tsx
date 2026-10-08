// analytics cards and loading states, shared by the page and by the route
// skeleton, so the skeleton shown while the page's code loads is the one the
// page shows while its data loads
import { Activity, Clock, Cpu, Gauge, Lock, Play, Upload } from 'lucide-react';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, formatDuration } from '@/lib/formatters';
import type { MetricsSnapshot } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import {
  ANALYTICS,
  LIBRARY_CHART,
  LIBRARY_COPY,
  RESPONSES_COPY,
  SERVER_CHART,
  THROUGHPUT_COPY,
} from './dashboard-layout';
import { lateSkeleton } from './live';
import { StatCard } from './StatCard';

const seconds = (s: number) => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
const percent = (n: number) => `${Math.round(n)}%`;
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

/** A chart card: title, description, then the chart box. */
export function ChartCard({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A chart's box while it loads, at the chart's own height. */
export function ChartLoading({ height }: { height: string }) {
  return <Skeleton className={cn(height, 'w-full', lateSkeleton)} />;
}

export function OperatorsOnlyAlert() {
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

export function ServerStats({ m, stagger = false }: { m?: MetricsSnapshot; stagger?: boolean }) {
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
    <AnimatedList as="div" initial={stagger ? 'hidden' : false} className={ANALYTICS.stats}>
      {stats.map(({ key, ...stat }) => (
        <AnimatedItem as="div" key={key} layout={false}>
          <StatCard {...stat} />
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}

/**
 * Analytics as it first draws, before any answer: what the route skeleton
 * shows while the page's code loads, built from the pieces the page shows
 * while its data loads.
 */
export function AnalyticsLoading({ operator }: { operator: boolean }) {
  return (
    <>
      {operator ? (
        <>
          <ServerStats />
          <div className={ANALYTICS.charts}>
            <ChartCard {...THROUGHPUT_COPY}>
              <ChartLoading height={SERVER_CHART} />
            </ChartCard>
            <ChartCard {...RESPONSES_COPY}>
              <ChartLoading height={SERVER_CHART} />
            </ChartCard>
          </div>
          <p aria-hidden="true" className={cn('h-4', ANALYTICS.updated)} />
        </>
      ) : (
        <OperatorsOnlyAlert />
      )}
      <ChartCard {...LIBRARY_COPY} className={ANALYTICS.library}>
        <ChartLoading height={LIBRARY_CHART} />
      </ChartCard>
    </>
  );
}
