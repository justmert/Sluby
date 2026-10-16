// the dashboard's cards and their loading bodies, shared by the page and by
// the route skeleton, so the skeleton shown while the page's code loads is
// the one the page shows while its data loads
import { Link } from 'react-router';
import { Clock, Film, HardDrive, Layers, RefreshCw } from 'lucide-react';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { AssetStats } from '@/hooks/useStats';
import { formatBytes, formatDuration } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import {
  CACHE_COPY,
  DASH,
  DEPLOYMENT_HEADING,
  RECONCILIATION_COPY,
  STATUS_TENANT_LINE,
  STORAGE_COPY,
  rememberedRows,
} from './dashboard-layout';
import { lateSkeleton } from './live';
import { StatCard } from './StatCard';

/** A dashboard card: title, optional description and action, then the body. */
export function DashCard({
  title,
  description,
  action,
  className,
  contentClassName,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('h-full', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description !== undefined && (
          <CardDescription className="break-words">{description}</CardDescription>
        )}
        {action !== undefined && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

/** Placeholder rows with the height of real ones, so the card keeps its size. */
export function RowSkeletons({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-5 items-center justify-between gap-4">
          <Skeleton className={cn('h-3.5 w-24', lateSkeleton)} />
          <Skeleton className={cn('h-3.5 w-16', lateSkeleton)} />
        </div>
      ))}
    </div>
  );
}

/** The large figure at the top of an operator card, with its line box kept while loading. */
export function BigFigure({ children }: { children?: React.ReactNode }) {
  return (
    <span className="block h-9 text-3xl leading-9 font-semibold tabular-nums">
      {children ?? <Skeleton className={cn('h-9 w-24', lateSkeleton)} />}
    </span>
  );
}

export const StatusBadgeLoading = () => (
  <Skeleton className={cn('h-5 w-24 rounded-full', lateSkeleton)} />
);

/** An operator gets the indexer url as the status description, which arrives with the status. */
export const StatusUrlLoading = () => <Skeleton className={cn('my-0.5 h-4 w-40', lateSkeleton)} />;

/** Three probes, a rule, then network, hosts, (your objects,) backend. */
export function StatusLoading({ ownObjects }: { ownObjects: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <RowSkeletons count={3} />
      <div className="my-1 border-t" />
      <RowSkeletons count={ownObjects ? 4 : 3} />
    </div>
  );
}

export function StorageLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <BigFigure />
        <Skeleton className={cn('h-1 w-full', lateSkeleton)} />
      </div>
      <RowSkeletons count={4} className="gap-4" />
    </div>
  );
}

export function CacheLoading() {
  return (
    <div className="flex flex-col gap-4">
      <BigFigure />
      <RowSkeletons count={3} className="gap-4" />
    </div>
  );
}

export function ReconciliationLoading() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-5 items-center justify-between gap-4">
        <Skeleton className={cn('h-5 w-16 rounded-full', lateSkeleton)} />
        <Skeleton className={cn('h-3.5 w-28', lateSkeleton)} />
      </div>
      <RowSkeletons count={4} />
    </div>
  );
}

export function LatestLoading({ count }: { count: number }) {
  return (
    <div className="flex flex-col divide-y" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className={cn('aspect-video w-16 @md/latest:w-20', lateSkeleton)} />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-3.5 w-2/5', lateSkeleton)} />
            <Skeleton className={cn('h-3 w-1/4', lateSkeleton)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The latest uploads card around its body. */
export function LatestCard({ children }: { children: React.ReactNode }) {
  return (
    <DashCard
      title="Latest uploads"
      className="@container/latest"
      action={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/studio/assets">View all</Link>
        </Button>
      }
    >
      {children}
    </DashCard>
  );
}

/** The reconciliation card's action, also drawn (disabled) by the route skeleton. */
export function RunNowButton({
  onClick,
  pending = false,
  disabled = false,
  icon = <RefreshCw />,
}: {
  onClick?: () => void;
  pending?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled || pending}>
      {icon}
      Run now
    </Button>
  );
}

/** Library totals by status; `created` uploads count as in progress, so the parts add up. */
function assetBreakdown(s: AssetStats): string {
  const inProgress = s.by_status.created + s.by_status.uploading + s.by_status.processing;
  return `${s.by_status.ready} ready, ${inProgress} in progress, ${s.by_status.failed} failed`;
}

/** The four library stat cards; `s` undefined while loading. */
export function LibraryStats({
  s,
  failed = false,
  stagger = false,
}: {
  s?: AssetStats;
  failed?: boolean;
  stagger?: boolean;
}) {
  return (
    <AnimatedList
      as="div"
      initial={stagger ? 'hidden' : false}
      aria-label="Library totals"
      role="list"
      className={DASH.stats}
    >
      <AnimatedItem as="div" role="listitem" key="assets" layout={false}>
        <StatCard
          icon={Film}
          label="Assets"
          value={s?.total}
          failed={failed}
          hint={s ? assetBreakdown(s) : null}
          longHint
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="stored" layout={false}>
        <StatCard
          icon={HardDrive}
          label="Stored on Sia"
          value={s?.stored_bytes}
          format={formatBytes}
          failed={failed}
          hint="Before erasure coding"
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="objects" layout={false}>
        <StatCard
          icon={Layers}
          label="Sia objects"
          value={s?.object_count}
          failed={failed}
          hint="Manifests, playlists, media, thumbnails"
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="playtime" layout={false}>
        <StatCard
          icon={Clock}
          label="Ready playtime"
          value={s?.ready_duration_ms}
          format={formatDuration}
          failed={failed}
        />
      </AnimatedItem>
    </AnimatedList>
  );
}

/**
 * The dashboard as it first draws, before any answer: what the route
 * skeleton shows while the page's code loads. The page renders the same
 * pieces while its data loads, so nothing moves when it takes over.
 */
export function DashboardLoading({ operator }: { operator: boolean }) {
  return (
    <>
      <LibraryStats />
      <div className={DASH.main}>
        <div className={DASH.latest}>
          <LatestCard>
            <LatestLoading count={rememberedRows() ?? 3} />
          </LatestCard>
        </div>
        <DashCard
          title="Service status"
          description={operator ? <StatusUrlLoading /> : STATUS_TENANT_LINE}
          action={<StatusBadgeLoading />}
        >
          <StatusLoading ownObjects={!operator} />
        </DashCard>
      </div>
      {operator && (
        <section aria-label="Deployment" className="mt-4 flex flex-col gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">{DEPLOYMENT_HEADING}</h2>
          <div className={DASH.operator}>
            <DashCard {...STORAGE_COPY}>
              <StorageLoading />
            </DashCard>
            <DashCard {...CACHE_COPY}>
              <CacheLoading />
            </DashCard>
            <div className={DASH.reconciliation}>
              <DashCard {...RECONCILIATION_COPY} action={<RunNowButton disabled />}>
                <ReconciliationLoading />
              </DashCard>
            </div>
          </div>
        </section>
      )}
      <p aria-hidden="true" className={cn('h-4', DASH.updated)} />
    </>
  );
}
