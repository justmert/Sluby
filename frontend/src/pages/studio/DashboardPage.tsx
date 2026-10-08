import { useState } from 'react';
import { Link } from 'react-router';
import type { RetryStage, VideoAsset } from '@sluby/sdk';
import {
  AlertTriangle,
  Clock,
  Film,
  HardDrive,
  Info,
  Layers,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AssetStatusBadge } from '@/components/asset/AssetStatusBadge';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { lateSkeleton } from '@/components/dashboard/live';
import { StatCard } from '@/components/dashboard/StatCard';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import {
  AnimatedItem,
  AnimatedList,
  FadeSwap,
  NumberTicker,
  StatusTransition,
} from '@/components/motion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import { useRetryProcessing } from '@/hooks/asset-queries';
import {
  useAssetStats,
  useReconciliation,
  useRunReconciliation,
  useSystemStatus,
  type AccountReconciliation,
  type AssetStats,
  type DeploymentReconciliation,
  type DeploymentStatus,
  type HostPool,
  type Probe,
  type SystemStatus,
} from '@/hooks/useStats';
import { useLatestAssets } from '@/hooks/useLatestAssets';
import { formatBytes, formatDuration, formatRelativeTime } from '@/lib/formatters';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

// the content column is narrower than the viewport by the sidebar, so the
// grids below follow the width of this container, not media queries
const CONTAINER = '@container/dash';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function ratio(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, (part / whole) * 100) : 0;
}

const STATUS_COPY: Record<SystemStatus['status'], { label: string; tone: string }> = {
  ok: { label: 'Operational', tone: 'bg-success' },
  degraded: { label: 'Degraded', tone: 'bg-warning' },
  down: { label: 'Down', tone: 'bg-destructive' },
};

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full transition-colors duration-200',
        ok ? 'bg-success' : 'bg-destructive',
      )}
    />
  );
}

/**
 * A label and value. When both do not fit on one line the value moves under
 * the label as a whole, instead of breaking into a column of letters.
 */
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto min-w-0 text-right break-words">{children}</span>
    </div>
  );
}

function ProbeRow({ label, probe }: { label: string; probe: Probe }) {
  const detail = probe.ok ? `${probe.latency_ms} ms` : (probe.error ?? 'not answering');
  return (
    <Row
      label={
        <span className="flex items-center gap-2 text-foreground">
          <Dot ok={probe.ok} />
          {label}
        </span>
      }
    >
      <span className="text-muted-foreground tabular-nums">{detail}</span>
    </Row>
  );
}

/** Placeholder rows with the height of real ones, so the card keeps its size. */
function RowSkeletons({ count, className }: { count: number; className?: string }) {
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

function CardError({
  what,
  error,
  onRetry,
  retrying,
}: {
  what: string;
  error: Error;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 text-sm">
      <p className="text-destructive">
        Could not load {what}: {error.message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? <Spinner aria-hidden="true" /> : <RotateCcw />}
        Try again
      </Button>
    </div>
  );
}

function hostsLine(hosts: HostPool | null): string {
  if (!hosts) return 'unknown';
  return `${hosts.good_for_upload} of ${hosts.total} accept uploads, ${hosts.countries} countries`;
}

/** Library totals by status; `created` uploads count as in progress, so the parts add up. */
function assetBreakdown(s: AssetStats): string {
  const inProgress = s.by_status.created + s.by_status.uploading + s.by_status.processing;
  return `${s.by_status.ready} ready, ${inProgress} in progress, ${s.by_status.failed} failed`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** How the caller's own objects fared in the latest reconciliation run. */
function OwnObjectsRow() {
  const run = useReconciliation();
  let text: React.ReactNode;
  if (run.isPending) text = <Skeleton className={cn('ml-auto h-3.5 w-28', lateSkeleton)} />;
  else if (run.isError) text = `unavailable (${run.error.message})`;
  else if (run.data === null) text = 'not checked yet';
  // an operator gets the whole run, which the reconciliation card shows
  else if (run.data.scope !== 'account') return null;
  else {
    const r: AccountReconciliation = run.data;
    const when = formatRelativeTime(r.finished_at);
    text =
      r.status === 'failed'
        ? `last check failed, ${when}`
        : r.missing_count > 0
          ? `${plural(r.missing_count, 'object')} missing from Sia, checked ${when}`
          : `all on Sia, checked ${when}`;
  }
  return <Row label="Your objects">{text}</Row>;
}

function StatusCard({
  status,
  error,
  showOwnObjects,
  onRetry,
  retrying,
}: {
  status?: SystemStatus;
  error: Error | null;
  showOwnObjects: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const deployment = status?.scope === 'deployment' ? status : undefined;
  // an operator is shown the indexer url here, a tenant a fixed line
  const expectDeployment = !showOwnObjects;
  const state = status ? 'ready' : error ? 'error' : 'loading';
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Service status</CardTitle>
        <CardDescription className="break-words">
          {deployment ? (
            deployment.indexer.url
          ) : !status && expectDeployment ? (
            <Skeleton className={cn('my-0.5 h-4 w-40', lateSkeleton)} />
          ) : (
            'The server and the Sia network it stores on'
          )}
        </CardDescription>
        <CardAction>
          {status ? (
            <StatusTransition status={status.status}>
              <Badge variant="outline" className="gap-1.5">
                <span
                  className={cn('size-2 rounded-full', STATUS_COPY[status.status].tone)}
                  aria-hidden="true"
                />
                {STATUS_COPY[status.status].label}
              </Badge>
            </StatusTransition>
          ) : (
            !error && <Skeleton className={cn('h-5 w-24 rounded-full', lateSkeleton)} />
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        <FadeSwap swapKey={state}>
          {state === 'error' && error ? (
            <CardError what="the status" error={error} onRetry={onRetry} retrying={retrying} />
          ) : !status ? (
            <div className="flex flex-col gap-3">
              <RowSkeletons count={3} />
              <div className="my-1 border-t" />
              <RowSkeletons count={showOwnObjects ? 4 : 3} />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <ProbeRow label="Sia indexer" probe={status.indexer} />
              <ProbeRow label="Database" probe={status.database} />
              <ProbeRow label="Redis queue" probe={status.redis} />
              <div className="my-1 border-t" />
              <Row label="Network">{status.indexer.network}</Row>
              <Row label="Hosts">{hostsLine(status.indexer.hosts)}</Row>
              {showOwnObjects && <OwnObjectsRow />}
              <Row label="Backend">
                v{status.version}
                {deployment && `, up ${formatDuration(deployment.uptime_seconds * 1000)}`}
              </Row>
            </div>
          )}
        </FadeSwap>
      </CardContent>
    </Card>
  );
}

/** The large figure at the top of an operator card, with its line box kept while loading. */
function BigFigure({ children }: { children?: React.ReactNode }) {
  return (
    <span className="block h-9 text-3xl leading-9 font-semibold tabular-nums">
      {children ?? <Skeleton className={cn('h-9 w-24', lateSkeleton)} />}
    </span>
  );
}

function StorageCard({ status, storedBytes }: { status?: DeploymentStatus; storedBytes?: number }) {
  const account = status?.indexer.account;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Storage usage</CardTitle>
        <CardDescription>Data pinned to Sia through the indexer account</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FadeSwap swapKey={status ? 'ready' : 'loading'}>
          {!status ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <BigFigure />
                <Skeleton className={cn('h-1 w-full', lateSkeleton)} />
              </div>
              <RowSkeletons count={4} className="gap-4" />
            </div>
          ) : account ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <BigFigure>
                    <NumberTicker value={account.pinned_data} format={formatBytes} />
                  </BigFigure>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    of {formatBytes(account.max_pinned_data)}
                  </span>
                </div>
                <Progress
                  value={ratio(account.pinned_data, account.max_pinned_data)}
                  aria-label="Pinned data against the account limit"
                />
              </div>
              <Row label="On hosts, after erasure coding">{formatBytes(account.pinned_size)}</Row>
              <Row label="Remaining">{formatBytes(account.remaining_storage)}</Row>
              <Row label="Account">{account.ready ? 'ready' : 'not ready yet'}</Row>
              <Row label="Your library">
                {storedBytes === undefined ? '...' : formatBytes(storedBytes)}
              </Row>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Account usage unavailable: {status.indexer.error ?? 'the indexer did not answer'}
              </p>
              <Row label="Your library">
                {storedBytes === undefined ? '...' : formatBytes(storedBytes)}
              </Row>
            </div>
          )}
        </FadeSwap>
      </CardContent>
    </Card>
  );
}

const percent = (n: number) => `${Math.round(n)}%`;

function CacheCard({ status }: { status?: DeploymentStatus }) {
  const cache = status?.cache;
  const lookups = cache ? cache.hits + cache.misses : 0;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Cache statistics</CardTitle>
        <CardDescription>Delivery gateway cache in this backend process</CardDescription>
      </CardHeader>
      <CardContent>
        <FadeSwap swapKey={cache ? 'ready' : 'loading'}>
          {!cache ? (
            <div className="flex flex-col gap-4">
              <BigFigure />
              <RowSkeletons count={3} className="gap-4" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-baseline gap-2">
                <BigFigure>
                  {lookups > 0 ? (
                    <NumberTicker value={(cache.hits / lookups) * 100} format={percent} />
                  ) : (
                    'n/a'
                  )}
                </BigFigure>
                <span className="text-sm text-muted-foreground">hit ratio</span>
              </div>
              <Row label="Hits / misses">
                <span className="tabular-nums">
                  {cache.hits.toLocaleString()} / {cache.misses.toLocaleString()}
                </span>
              </Row>
              <div className="flex flex-col gap-2">
                <Row label="Object cache">
                  {formatBytes(cache.object_bytes)} of {formatBytes(cache.object_max_bytes)}
                </Row>
                <Progress
                  value={ratio(cache.object_bytes, cache.object_max_bytes)}
                  aria-label="Object cache fill"
                />
              </div>
              <Row label="Cached entries">
                {plural(cache.object_items, 'object')}, {plural(cache.manifest_items, 'manifest')}
              </Row>
            </div>
          )}
        </FadeSwap>
      </CardContent>
    </Card>
  );
}

const RUN_COPY: Record<
  DeploymentReconciliation['status'],
  { label: string; variant: 'success' | 'warning' | 'destructive' }
> = {
  ok: { label: 'In sync', variant: 'success' },
  drift: { label: 'Drift', variant: 'warning' },
  failed: { label: 'Failed', variant: 'destructive' },
};

/** The run's badge; drift made only of untracked objects says why it is harmless. */
function RunBadge({ run }: { run: DeploymentReconciliation }) {
  const copy = RUN_COPY[run.status];
  const orphansOnly = run.status === 'drift' && run.missing_count === 0;
  const badge = (
    <Badge variant={copy.variant} tabIndex={orphansOnly ? 0 : undefined} className="gap-1">
      {copy.label}
      {orphansOnly && <Info aria-hidden="true" />}
    </Badge>
  );
  return (
    <StatusTransition status={run.status}>
      {orphansOnly ? (
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent className="max-w-64">
            Nothing is missing. The indexer holds {plural(run.orphan_count, 'object')} that no asset
            here refers to, often left by an interrupted upload. They take up storage but break
            nothing; the run only reports them.
          </TooltipContent>
        </Tooltip>
      ) : (
        badge
      )}
    </StatusTransition>
  );
}

function ReconciliationCard() {
  const run = useReconciliation();
  const start = useRunReconciliation();
  const r = run.data?.scope === 'deployment' ? run.data : null;

  const runNow = async () => {
    try {
      const enqueued = await start.mutateAsync();
      toast.success(enqueued ? 'Reconciliation run queued' : 'A run is already queued');
    } catch (err) {
      toast.error(`Could not start a run: ${errorText(err)}`);
    }
  };

  const state = run.isPending ? 'loading' : run.isError ? 'error' : r ? 'ready' : 'none';
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Reconciliation</CardTitle>
        <CardDescription>The database against the indexer, for every account</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runNow()}
            disabled={start.isPending}
          >
            {start.isPending ? <Spinner aria-hidden="true" /> : <RefreshCw />}
            Run now
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FadeSwap swapKey={state}>
          {run.isPending ? (
            <div className="flex flex-col gap-3">
              <div className="flex h-5 items-center justify-between gap-4">
                <Skeleton className={cn('h-5 w-16 rounded-full', lateSkeleton)} />
                <Skeleton className={cn('h-3.5 w-28', lateSkeleton)} />
              </div>
              <RowSkeletons count={4} />
            </div>
          ) : run.isError ? (
            <CardError
              what="the latest run"
              error={run.error}
              onRetry={() => void run.refetch()}
              retrying={run.isFetching}
            />
          ) : !r ? (
            <p className="text-sm text-muted-foreground">No run has finished yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <RunBadge run={r} />
                <span className="text-muted-foreground">
                  finished {formatRelativeTime(r.finished_at)}
                </span>
              </div>
              {r.status === 'failed' ? (
                <p className="text-sm break-words text-destructive">
                  {r.error_message ?? 'The run stopped without a message.'}
                </p>
              ) : (
                <>
                  <Row label="In sync">{r.in_sync_count.toLocaleString()}</Row>
                  <Row label="Missing from the indexer">{r.missing_count.toLocaleString()}</Row>
                  <Row label="On the indexer, not tracked">{r.orphan_count.toLocaleString()}</Row>
                  <Row label="Objects compared">
                    {r.db_object_count.toLocaleString()} tracked,{' '}
                    {r.indexer_object_count.toLocaleString()} on the indexer
                  </Row>
                </>
              )}
            </div>
          )}
        </FadeSwap>
      </CardContent>
    </Card>
  );
}

function OperatorCards({
  status,
  error,
  storedBytes,
  stagger,
}: {
  status?: SystemStatus;
  error: Error | null;
  storedBytes?: number;
  stagger: boolean;
}) {
  // an account view, or a failure the status card already reports
  if (status ? status.scope !== 'deployment' : error) return null;
  const deployment = status?.scope === 'deployment' ? status : undefined;
  return (
    <section aria-label="Deployment" className="mt-4 flex flex-col gap-4">
      <h2 className="text-sm font-medium text-muted-foreground">Deployment, shown to operators</h2>
      {/* one column until a card has room for its rows, about 336 px each */}
      <AnimatedList
        as="div"
        initial={stagger ? 'hidden' : false}
        className="grid gap-4 @2xl/dash:grid-cols-2 @5xl/dash:grid-cols-3"
      >
        <AnimatedItem as="div" key="storage" layout={false}>
          <StorageCard status={deployment} storedBytes={storedBytes} />
        </AnimatedItem>
        <AnimatedItem as="div" key="cache" layout={false}>
          <CacheCard status={deployment} />
        </AnimatedItem>
        <AnimatedItem
          as="div"
          key="reconciliation"
          layout={false}
          className="@2xl/dash:col-span-2 @5xl/dash:col-span-1"
        >
          <ReconciliationCard />
        </AnimatedItem>
      </AnimatedList>
    </section>
  );
}

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  transcode: 'Transcoding',
  upload: 'Storing on Sia',
  finalize: 'Finalizing',
  completed: 'Finishing',
};

/** What a processing asset is doing now, with a thin bar along the row's bottom edge. */
function RowProgress({ asset }: { asset: VideoAsset }) {
  const job = useProcessingJob(asset.id, asset.status, asset.status === 'processing');
  if (asset.status !== 'processing' || !job.data || job.data.status === 'failed') return null;
  const pct = Math.round(job.data.progressPercent);
  const stage =
    job.data.status === 'retrying' ? 'Retrying' : (STAGE_LABEL[job.data.stage] ?? 'Processing');
  return (
    <>
      <span className="tabular-nums">
        {' · '}
        {stage}, {pct}%
      </span>
      <Progress
        value={pct}
        aria-label={`${asset.title}: processing progress`}
        className="absolute inset-x-2 bottom-0 h-0.5 bg-transparent"
      />
    </>
  );
}

const RETRY_STAGE_LABEL: Record<RetryStage, string> = {
  transcode: 'the transcode',
  'upload-segments': 'the Sia upload',
};

function RetryButton({ asset }: { asset: VideoAsset }) {
  const retry = useRetryProcessing();
  const run = async () => {
    try {
      const { stage } = await retry.mutateAsync(asset.id);
      toast.success(`${asset.title}: processing restarted from ${RETRY_STAGE_LABEL[stage]}`);
    } catch (err) {
      toast.error(`Retry failed: ${errorText(err)}`);
    }
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void run()}
      disabled={retry.isPending}
      aria-label={`Retry processing ${asset.title}`}
    >
      {retry.isPending ? <Spinner aria-hidden="true" /> : <RotateCcw />}
      <span className="hidden @md/latest:inline">Retry</span>
    </Button>
  );
}

function UploadRow({ asset }: { asset: VideoAsset }) {
  return (
    <div className="flex items-center gap-1">
      <Link
        to={`/studio/assets/${asset.id}`}
        className="relative -mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2.5 outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <AssetThumbnail
          thumbnailObjectIds={asset.thumbnailObjectIds}
          className="w-16 shrink-0 @md/latest:w-20"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={asset.title}>
            {asset.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {formatRelativeTime(asset.createdAt)}
            {!!asset.durationMs && ` · ${formatDuration(asset.durationMs)}`}
            {asset.status === 'ready' &&
              asset.totalStorageBytes > 0 &&
              ` · ${formatBytes(asset.totalStorageBytes)}`}
            <RowProgress asset={asset} />
          </p>
        </div>
        <StatusTransition status={asset.status} className="shrink-0">
          <AssetStatusBadge status={asset.status} />
        </StatusTransition>
      </Link>
      {asset.status === 'failed' && <RetryButton asset={asset} />}
    </div>
  );
}

const LATEST = 6;

function LatestUploads({ expected }: { expected?: number }) {
  const latest = useLatestAssets(LATEST);
  const assets = latest.data?.data ?? [];
  // as many placeholder rows as there will be rows, once the totals know
  const placeholders = expected === undefined ? 3 : Math.max(1, Math.min(LATEST, expected));
  const state = latest.isPending
    ? 'loading'
    : latest.isError && !latest.data
      ? 'error'
      : assets.length === 0
        ? 'empty'
        : 'list';

  return (
    <Card className="@container/latest h-full">
      <CardHeader>
        <CardTitle>Latest uploads</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/studio/assets">View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FadeSwap swapKey={state}>
          {state === 'loading' ? (
            <div className="flex flex-col divide-y" aria-hidden="true">
              {Array.from({ length: placeholders }, (_, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <Skeleton className={cn('aspect-video w-16 @md/latest:w-20', lateSkeleton)} />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className={cn('h-3.5 w-2/5', lateSkeleton)} />
                    <Skeleton className={cn('h-3 w-1/4', lateSkeleton)} />
                  </div>
                </div>
              ))}
            </div>
          ) : state === 'error' && latest.error ? (
            <CardError
              what="assets"
              error={latest.error}
              onRetry={() => void latest.refetch()}
              retrying={latest.isFetching}
            />
          ) : state === 'empty' ? (
            <Empty className="border-0 p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Film />
                </EmptyMedia>
                <EmptyTitle>No videos yet</EmptyTitle>
                <EmptyDescription>
                  Upload a video to see it transcoded and pinned to Sia.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild>
                  <Link to="/studio/upload">
                    <Upload />
                    Upload video
                  </Link>
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            // rows on screen when the list mounts were crossfaded in already;
            // later uploads fade in and deleted ones fade out
            <AnimatedList initial={false} className="flex flex-col divide-y">
              {assets.map((asset) => (
                <AnimatedItem key={asset.id}>
                  <UploadRow asset={asset} />
                </AnimatedItem>
              ))}
            </AnimatedList>
          )}
        </FadeSwap>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { operator } = useSession();
  const stats = useAssetStats();
  const system = useSystemStatus();
  const s = stats.data;
  // the server decides what the caller may see; the operator flag only
  // decides whether to ask for and show the deployment views
  const deploymentView = operator && system.data?.scope !== 'account';
  // cards stagger in when the page has to wait for its first numbers; back
  // on a page whose data is cached they are simply there
  const [stagger] = useState(() => s === undefined);
  const failed = stats.isError && !s;

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Your video library and the Sia storage behind it"
        actions={
          <Button asChild>
            <Link to="/studio/upload">
              <Upload />
              Upload video
            </Link>
          </Button>
        }
      />

      <div className={CONTAINER}>
        {stats.isError && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle />
            <AlertTitle>
              {s ? 'Library totals stopped updating' : 'Could not load library totals'}
            </AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <p>
                {stats.error.message}
                {s && '. The figures below are from the last good reading.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void stats.refetch()}
                disabled={stats.isFetching}
              >
                {stats.isFetching ? <Spinner aria-hidden="true" /> : <RotateCcw />}
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <AnimatedList
          as="div"
          initial={stagger ? 'hidden' : false}
          aria-label="Library totals"
          role="list"
          className="grid grid-cols-2 gap-4 @3xl/dash:grid-cols-4"
        >
          <AnimatedItem as="div" role="listitem" key="assets" layout={false}>
            <StatCard
              icon={Film}
              label="Assets"
              value={s?.total}
              failed={failed}
              hint={s ? assetBreakdown(s) : null}
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

        <AnimatedList
          as="div"
          initial={stagger ? 'hidden' : false}
          className="mt-4 grid gap-4 @3xl/dash:grid-cols-3"
        >
          <AnimatedItem as="div" key="latest" layout={false} className="@3xl/dash:col-span-2">
            <LatestUploads expected={s?.total} />
          </AnimatedItem>
          <AnimatedItem as="div" key="status" layout={false}>
            <StatusCard
              status={system.data}
              error={system.error}
              showOwnObjects={!deploymentView}
              onRetry={() => void system.refetch()}
              retrying={system.isFetching}
            />
          </AnimatedItem>
        </AnimatedList>

        {deploymentView && (
          <OperatorCards
            status={system.data}
            error={system.error}
            storedBytes={s?.stored_bytes}
            stagger={stagger}
          />
        )}

        <UpdatedAgo
          className="mt-6"
          updatedAt={stats.dataUpdatedAt}
          stale={stats.isError}
          label="Totals updated"
        />
      </div>
    </PageContainer>
  );
}
