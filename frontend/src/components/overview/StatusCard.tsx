import { Link } from 'react-router';
import { InlineError } from '@/components/shared/InlineError';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Probe, Reconciliation, SystemStatus } from '@/hooks/useStats';
import { healthOf } from '@/hooks/useSystemStatus';
import { ROUTES } from '@/lib/constants';
import { formatRelativeTime, plural } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

const STATUS_TITLE = 'Status';
const STATUS_DESCRIPTION = 'This server and its connection to Sia';

type Tone = 'ok' | 'bad' | 'muted';

const DOT: Record<Tone, string> = {
  ok: 'bg-success',
  bad: 'bg-destructive',
  muted: 'bg-muted-foreground',
};

function Row({ label, tone, children }: { label: string; tone: Tone; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm first:pt-0 last:pb-0">
      <dt className="flex items-center gap-2">
        {/* the words beside it carry the state; the dot only repeats it */}
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[tone])} />
        {label}
      </dt>
      <dd
        className={cn(
          'ml-auto text-right tabular-nums',
          tone === 'bad' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

const probeValue = (p: Probe) => (p.ok ? `${p.latency_ms} ms` : 'Not responding');

/** The database and the job queue as one row: the worst of the two wins. */
function serverProbe(s: SystemStatus): Probe {
  if (!s.database.ok) return s.database;
  if (!s.redis.ok) return s.redis;
  return { ok: true, latency_ms: Math.max(s.database.latency_ms, s.redis.latency_ms) };
}

function filesLine(
  run: Reconciliation | null | undefined,
  runFailed: boolean,
): { tone: Tone; text: string } {
  if (runFailed) return { tone: 'muted', text: 'Could not load the storage check' };
  if (run === undefined) return { tone: 'muted', text: 'Not checked yet' };
  if (run === null) return { tone: 'muted', text: 'Not checked yet' };
  const when = formatRelativeTime(run.finished_at);
  if (run.status === 'failed') return { tone: 'bad', text: `Check failed (${when})` };
  if (run.missing_count > 0) {
    return {
      tone: 'bad',
      text: `${plural(run.missing_count, 'file')} missing from Sia (checked ${when})`,
    };
  }
  return { tone: 'ok', text: `All on Sia (checked ${when})` };
}

export function StatusLoading() {
  return (
    <div aria-hidden="true" className="flex flex-col divide-y">
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="flex h-10 items-center justify-between gap-4 first:h-7.5 first:items-start last:h-7.5 last:items-end"
        >
          <Skeleton className={cn('h-3.5 w-24', lateReveal)} />
          <Skeleton className={cn('h-3.5 w-16', lateReveal)} />
        </div>
      ))}
    </div>
  );
}

export const StatusBadgeLoading = () => (
  <Skeleton className={cn('h-5.5 w-24 rounded-full', lateReveal)} />
);

/** The frame of the card, also drawn by the route skeleton. */
export function StatusFrame({
  badge,
  footer,
  children,
}: {
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{STATUS_TITLE}</CardTitle>
        <CardDescription>{STATUS_DESCRIPTION}</CardDescription>
        {badge && <CardAction>{badge}</CardAction>}
      </CardHeader>
      {/* the content takes the spare height, so the footer sits at the card's bottom edge */}
      <CardContent className="flex-1">{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}

/**
 * Overview's status: one verdict, Sia storage, this server (database and
 * job queue together) and whether the files are on Sia. Operators get a way
 * to the full Health page; the internals live there (D-07).
 */
export function StatusCard({
  status,
  error,
  onRetry,
  retrying,
  run,
  runFailed = false,
  operator,
}: {
  status?: SystemStatus;
  error: Error | null;
  onRetry: () => void;
  retrying: boolean;
  /** the latest storage check; null before any, undefined while it loads */
  run: Reconciliation | null | undefined;
  /** the storage check could not load, so nothing is known about the files */
  runFailed?: boolean;
  operator: boolean;
}) {
  const files = filesLine(run, runFailed);
  return (
    <StatusFrame
      badge={
        status ? (
          <StatusBadge kind="health" status={healthOf(status)} />
        ) : error ? null : (
          <StatusBadgeLoading />
        )
      }
      footer={
        operator && (
          <Button variant="outline" size="sm" asChild className="ml-auto">
            <Link to={ROUTES.DEPLOYMENT}>Open health</Link>
          </Button>
        )
      }
    >
      {!status && error ? (
        <InlineError what="the status" error={error} onRetry={onRetry} retrying={retrying} />
      ) : !status ? (
        <StatusLoading />
      ) : (
        <>
          <dl className="flex flex-col divide-y">
            <Row label="Sia storage" tone={status.indexer.ok ? 'ok' : 'bad'}>
              {probeValue(status.indexer)}
            </Row>
            <Row label="This server" tone={serverProbe(status).ok ? 'ok' : 'bad'}>
              {probeValue(serverProbe(status))}
            </Row>
            <Row label={operator ? 'Files on Sia' : 'Your files on Sia'} tone={files.tone}>
              {files.text}
            </Row>
          </dl>
          {error && (
            <InlineError
              title="Status is out of date"
              error={error}
              note="Showing the last figures that loaded."
              onRetry={onRetry}
              retrying={retrying}
              className="mt-3"
            />
          )}
        </>
      )}
    </StatusFrame>
  );
}
