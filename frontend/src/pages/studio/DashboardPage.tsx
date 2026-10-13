import { Link } from 'react-router';
import {
  AlertTriangle,
  Clock,
  Database,
  Film,
  HardDrive,
  Layers,
  Server,
  Upload,
  type LucideIcon,
} from 'lucide-react';
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
import { useAssetStats, useSystemStatus, type Probe, type SystemStatus } from '@/hooks/useStats';
import { useLatestAssets } from '@/hooks/useLatestAssets';
import { formatBytes, formatDuration, formatRelativeTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

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
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="flex items-center gap-2">
        <Dot ok={probe.ok} />
        {label}
      </span>
      <span className="text-right text-muted-foreground tabular-nums">
        {probe.ok ? `${probe.latency_ms} ms` : (probe.error ?? 'unavailable')}
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function StorageCard({ status, storedBytes }: { status?: SystemStatus; storedBytes?: number }) {
  const account = status?.indexer.account;
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
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {status
              ? `Account usage unavailable: ${status.indexer.error ?? 'indexer not connected'}`
              : 'Loading account usage...'}
          </p>
        )}
        <Row label="Your library">
          {storedBytes === undefined ? '...' : formatBytes(storedBytes)}
        </Row>
      </CardContent>
    </Card>
  );
}

function CacheCard({ status }: { status?: SystemStatus }) {
  const cache = status?.cache;
  const lookups = cache ? cache.hits + cache.misses : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cache statistics</CardTitle>
        <CardDescription>Delivery gateway cache in this backend process</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {cache ? (
          <>
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
              {cache.object_items} objects, {cache.manifest_items} manifests
            </Row>
          </>
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

function IndexerCard({ status }: { status?: SystemStatus }) {
  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Indexer status</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }
  const { indexer, reconciliation } = status;
  const copy = STATUS_COPY[status.status];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Indexer status</CardTitle>
        <CardDescription className="truncate">{indexer.url}</CardDescription>
        <CardAction>
          <Badge variant="outline" className="gap-1.5">
            <span className={cn('size-2 rounded-full', copy.tone)} aria-hidden="true" />
            {copy.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProbeRow label="Sia indexer" probe={indexer} />
        <ProbeRow label="Database" probe={status.database} />
        <ProbeRow label="Redis queue" probe={status.redis} />
        <div className="my-1 border-t" />
        <Row label="Network">{indexer.network}</Row>
        <Row label="Account">
          {indexer.account ? (indexer.account.ready ? 'ready' : 'not ready') : 'unknown'}
        </Row>
        <Row label="Hosts">
          {indexer.hosts
            ? `${indexer.hosts.good_for_upload} of ${indexer.hosts.total} accepting uploads, ${indexer.hosts.countries} countries`
            : 'unknown'}
        </Row>
        <Row label="Last reconciliation">
          {reconciliation
            ? `${reconciliation.status}, ${formatRelativeTime(reconciliation.finished_at)}`
            : 'never run'}
        </Row>
        <Row label="Backend">
          v{status.version}, up {formatDuration(status.uptime_seconds * 1000)}
        </Row>
      </CardContent>
    </Card>
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
                  <AssetThumbnail
                    thumbnailObjectIds={asset.thumbnailObjectIds}
                    title={asset.title}
                    className="w-20"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{asset.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(asset.createdAt)}
                      {asset.durationMs > 0 && ` · ${formatDuration(asset.durationMs)}`}
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
  const stats = useAssetStats();
  const system = useSystemStatus();
  const s = stats.data;

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
          value={s?.total.toLocaleString()}
          hint={
            s &&
            `${s.by_status.ready} ready, ${s.by_status.processing + s.by_status.uploading} in progress, ${s.by_status.failed} failed`
          }
        />
        <StatCard
          icon={HardDrive}
          label="Stored on Sia"
          loading={stats.isLoading}
          value={s && formatBytes(s.stored_bytes)}
          hint="Before erasure coding"
        />
        <StatCard
          icon={Layers}
          label="Sia objects"
          loading={stats.isLoading}
          value={s?.object_count.toLocaleString()}
          hint="Manifests, playlists, media, thumbnails"
        />
        <StatCard
          icon={Clock}
          label="Ready playtime"
          loading={stats.isLoading}
          value={s && formatDuration(s.ready_duration_ms)}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <LatestUploads />
        <IndexerCard status={system.data} />
        <StorageCard status={system.data} storedBytes={s?.stored_bytes} />
        <CacheCard status={system.data} />
        {system.isError && (
          <Alert variant="destructive">
            <Server />
            <AlertTitle>Status unavailable</AlertTitle>
            <AlertDescription>{system.error.message}</AlertDescription>
          </Alert>
        )}
      </div>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Database className="size-3.5" />
        Totals refresh every 15 seconds.
      </p>
    </PageContainer>
  );
}
