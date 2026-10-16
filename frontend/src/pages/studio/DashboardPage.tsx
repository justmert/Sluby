import { Link } from 'react-router';
import {
  AlertTriangle,
  Clock,
  Database,
  Film,
  HardDrive,
  Layers,
  RefreshCw,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AssetStatusBadge } from '@/components/asset/AssetStatusBadge';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
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

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {loading ? <Skeleton className="h-8 w-20" /> : value}
        </CardTitle>
      </CardHeader>
      {hint && !loading && (
        <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
      )}
    </Card>
  );
}

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
        'inline-block size-2 shrink-0 rounded-full',
        ok ? 'bg-success' : 'bg-destructive',
      )}
    />
  );
}

function ProbeRow({ label, probe }: { label: string; probe: Probe }) {
  const detail = probe.ok ? `${probe.latency_ms} ms` : (probe.error ?? 'not answering');
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="flex shrink-0 items-center gap-2">
        <Dot ok={probe.ok} />
        {label}
      </span>
      <span className="min-w-0 text-right break-words text-muted-foreground tabular-nums">
        {detail}
      </span>
    </div>
  );
}

/** A label and value; long values wrap instead of being cut off. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  );
}

function CardError({ what, error }: { what: string; error: Error }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      Could not load {what}: {error.message}
    </p>
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

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** How the caller's own objects fared in the latest reconciliation run. */
function OwnObjectsRow() {
  const run = useReconciliation();
  let text: string;
  if (run.isPending) text = '...';
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
}: {
  status?: SystemStatus;
  error: Error | null;
  showOwnObjects: boolean;
}) {
  const deployment = status?.scope === 'deployment' ? status : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Service status</CardTitle>
        <CardDescription className="break-words">
          {deployment ? deployment.indexer.url : 'The server and the Sia network it stores on'}
        </CardDescription>
        {status && (
          <CardAction>
            <Badge variant="outline" className="gap-1.5">
              <span
                className={cn('size-2 rounded-full', STATUS_COPY[status.status].tone)}
                aria-hidden="true"
              />
              {STATUS_COPY[status.status].label}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!status && error ? (
          <CardError what="the status" error={error} />
        ) : !status ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StorageCard({ status, storedBytes }: { status: DeploymentStatus; storedBytes?: number }) {
  const account = status.indexer.account;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage usage</CardTitle>
        <CardDescription>Data pinned to Sia through the indexer account</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {account ? (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium tabular-nums">{formatBytes(account.pinned_data)}</span>
                <span className="text-muted-foreground tabular-nums">
                  of {formatBytes(account.max_pinned_data)}
                </span>
              </div>
              <Progress
                value={ratio(account.pinned_data, account.max_pinned_data)}
                aria-label="Pinned data against the account limit"
              />
            </div>
            <Row label="On hosts (after erasure coding)">{formatBytes(account.pinned_size)}</Row>
            <Row label="Remaining">{formatBytes(account.remaining_storage)}</Row>
            <Row label="Account">{account.ready ? 'ready' : 'not ready yet'}</Row>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Account usage unavailable: {status.indexer.error ?? 'the indexer did not answer'}
          </p>
        )}
        <Row label="Your library">
          {storedBytes === undefined ? '...' : formatBytes(storedBytes)}
        </Row>
      </CardContent>
    </Card>
  );
}

function CacheCard({ status }: { status: DeploymentStatus }) {
  const { cache } = status;
  const lookups = cache.hits + cache.misses;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cache statistics</CardTitle>
        <CardDescription>Delivery gateway cache in this backend process</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {lookups > 0 ? `${Math.round((cache.hits / lookups) * 100)}%` : 'n/a'}
          </span>
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

function ReconciliationCard() {
  const run = useReconciliation();
  const start = useRunReconciliation();
  const r = run.data?.scope === 'deployment' ? run.data : null;

  const runNow = async () => {
    try {
      const enqueued = await start.mutateAsync();
      toast.success(enqueued ? 'Reconciliation run queued' : 'A run is already queued');
    } catch (err) {
      toast.error(`Could not start a run: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Card>
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
            <RefreshCw />
            Run now
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {run.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : run.isError ? (
          <CardError what="the latest run" error={run.error} />
        ) : !r ? (
          <p className="text-sm text-muted-foreground">No run has finished yet.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 text-sm">
              <Badge variant={RUN_COPY[r.status].variant}>{RUN_COPY[r.status].label}</Badge>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OperatorCards({
  status,
  error,
  storedBytes,
}: {
  status?: SystemStatus;
  error: Error | null;
  storedBytes?: number;
}) {
  // an account view, or a failure the status card already reports
  if (status ? status.scope !== 'deployment' : error) return null;
  const deployment = status?.scope === 'deployment' ? status : undefined;
  return (
    <section aria-label="Deployment" className="mt-4 flex flex-col gap-4">
      <h2 className="text-sm font-medium text-muted-foreground">Deployment, shown to operators</h2>
      {!deployment ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StorageCard status={deployment} storedBytes={storedBytes} />
          <CacheCard status={deployment} />
          <ReconciliationCard />
        </div>
      )}
    </section>
  );
}

function LatestUploads() {
  const latest = useLatestAssets(6);
  const assets = latest.data?.data ?? [];

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Latest uploads</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/studio/assets">View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {latest.isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : latest.isError ? (
          <p className="text-sm text-destructive">Could not load assets: {latest.error.message}</p>
        ) : assets.length === 0 ? (
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
          <ul className="flex flex-col divide-y">
            {assets.map((asset) => (
              <li key={asset.id}>
                <Link
                  to={`/studio/assets/${asset.id}`}
                  className="flex items-center gap-3 rounded-md py-2.5 transition-colors hover:bg-muted/50"
                >
                  <AssetThumbnail thumbnailObjectIds={asset.thumbnailObjectIds} className="w-20" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={asset.title}>
                      {asset.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(asset.createdAt)}
                      {!!asset.durationMs && ` · ${formatDuration(asset.durationMs)}`}
                      {asset.totalStorageBytes > 0 && ` · ${formatBytes(asset.totalStorageBytes)}`}
                    </p>
                  </div>
                  <AssetStatusBadge status={asset.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { operator } = useSession();
  const stats = useAssetStats();
  const system = useSystemStatus();
  const s = stats.data;
  // the server decides what the caller may see; the operator flag only
  // decides whether to ask for and show the deployment views
  const deploymentView = operator && system.data?.scope !== 'account';

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

      {stats.isError && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>Could not load library totals</AlertTitle>
          <AlertDescription>{stats.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Film}
          label="Assets"
          loading={stats.isLoading}
          value={s ? s.total.toLocaleString() : '-'}
          hint={s && assetBreakdown(s)}
        />
        <StatCard
          icon={HardDrive}
          label="Stored on Sia"
          loading={stats.isLoading}
          value={s ? formatBytes(s.stored_bytes) : '-'}
          hint="Before erasure coding"
        />
        <StatCard
          icon={Layers}
          label="Sia objects"
          loading={stats.isLoading}
          value={s ? s.object_count.toLocaleString() : '-'}
          hint="Manifests, playlists, media, thumbnails"
        />
        <StatCard
          icon={Clock}
          label="Ready playtime"
          loading={stats.isLoading}
          value={s ? formatDuration(s.ready_duration_ms) : '-'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <LatestUploads />
        <StatusCard status={system.data} error={system.error} showOwnObjects={!deploymentView} />
      </div>

      {deploymentView && (
        <OperatorCards status={system.data} error={system.error} storedBytes={s?.stored_bytes} />
      )}

      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Database className="size-3.5" />
        Totals refresh every 15 seconds.
      </p>
    </PageContainer>
  );
}
