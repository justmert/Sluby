import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Waves,
  Upload,
  Key,
  BarChart3,
  Database,
  Globe,
  Server,
  Zap,
  Clock,
  Activity,
  ArrowRight,
  FileVideo,
  RefreshCw,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { useMetrics, type MetricsWithHistory } from '@/hooks/useMetrics';
import { useAssets, type VideoAsset } from '@/hooks/useAssets';
import { formatBytes, formatRelativeTime } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import {
  EXPLORER_BASE_URL,
  EXPLORER_LABEL,
  EXTERNAL_LINK_PROPS,
  IS_TESTNET_EXPLORER,
} from '@/lib/sia-explorer';
import { ObjectIdBadge } from '@/components/shared/ObjectIdBadge';

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex h-2 w-2', className)}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
    created: { label: 'Created', variant: 'secondary' },
    uploading: { label: 'Uploading', variant: 'warning' },
    processing: { label: 'Processing', variant: 'warning' },
    ready: { label: 'Ready', variant: 'success' },
    failed: { label: 'Failed', variant: 'destructive' },
  };
  const c = config[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  loading?: boolean;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 hover:bg-white/[0.05] transition-all duration-200">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-white/[0.05]">
          <Icon className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-400 font-medium">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-16 mt-0.5" />
          ) : (
            <p className="text-2xl font-bold text-[#f0f0f0] tabular-nums truncate">
              {value}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assetLink(asset: VideoAsset): string {
  if (asset.status === 'ready') return `/studio/player?asset=${asset.id}`;
  return `/studio/assets/${asset.id}`;
}

function formatCacheHitRate(metrics: MetricsWithHistory['current']): string {
  const total = metrics.cacheHits + metrics.cacheMisses;
  if (total === 0) return '0%';
  return `${((metrics.cacheHits / total) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex-1">
              <Skeleton className="h-3 w-16 mb-1.5" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentActivitySkeleton() {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
      <div className="divide-y divide-white/[0.04]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-3.5">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div>
                <Skeleton className="h-4 w-40 mb-1" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const health = useHealthCheck(15_000);
  const metrics = useMetrics(15_000);
  const recentAssets = useAssets({ limit: 10 });
  const allAssets = useAssets({ limit: 100 });

  const isHealthy = health.data?.status === 'ok';
  const isHealthLoading = health.isLoading;
  const isHealthError = health.isError;

  return (
    <PageContainer>
      {/* Hero Header */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative mb-8 pb-6 border-b border-white/[0.08]"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Waves className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[#f0f0f0] font-heading">
                Sluby
              </h1>
              <p className="text-sm text-zinc-400">
                Decentralized video infrastructure on Sia
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {isHealthLoading && (
            <Badge variant="secondary" className="gap-1.5">
              <Server className="w-3 h-3 animate-pulse" />
              Connecting...
            </Badge>
          )}
          {isHealthError && (
            <Badge variant="destructive" className="gap-1.5">
              <Server className="w-3 h-3" />
              Backend Offline
            </Badge>
          )}
          {health.data && (
            <>
              <Badge variant={isHealthy ? 'success' : 'destructive'} className="gap-1.5">
                {isHealthy && <LiveDot className="h-1.5 w-1.5" />}
                {isHealthy ? 'All Systems Operational' : 'Service Degraded'}
              </Badge>
              <span className="text-xs text-zinc-500">
                v{health.data.version}
              </span>
            </>
          )}
          <Badge variant="secondary" className="gap-1.5 bg-teal-500/10 text-teal-400 border-teal-500/20">
            <Database className="w-3 h-3" />
            {IS_TESTNET_EXPLORER ? 'Zen Testnet' : 'Sia Mainnet'}
          </Badge>
          <a
            href={EXPLORER_BASE_URL}
            {...EXTERNAL_LINK_PROPS}
            title={`Browse ${EXPLORER_LABEL}`}
            className="inline-flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
            {EXPLORER_LABEL}
          </a>
        </div>
      </motion.section>

      {/* Quick Actions Bar */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3">
          <Button asChild className="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 border-0 text-white rounded-lg shadow-lg shadow-teal-500/20">
            <Link to="/studio/upload" className="gap-2">
              <Upload className="w-4 h-4" />
              Upload Video
            </Link>
          </Button>
          <Button variant="ghost" asChild className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 rounded-lg border-0">
            <Link to="/studio/developer" className="gap-2">
              <Key className="w-4 h-4" />
              Create API Key
            </Link>
          </Button>
          <Button variant="ghost" asChild className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 rounded-lg border-0">
            <Link to="/studio/analytics" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              View Analytics
            </Link>
          </Button>
        </div>
      </motion.section>

      {/* Metrics Grid */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="mb-8"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading">System Metrics</h2>
            <p className="text-sm text-zinc-400 mt-0.5">Real-time metrics, refreshed every 15s</p>
          </div>
          {metrics.isError && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => metrics.refetch()}
              className="gap-1.5 text-red-400 hover:text-red-300"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </Button>
          )}
        </div>

        {allAssets.isLoading ? (
          <MetricsSkeleton />
        ) : (() => {
          const assets = allAssets.data?.data ?? [];
          const totalAssets = allAssets.data?.total ?? 0;
          const readyCount = assets.filter(a => a.status === 'ready').length;
          const processingCount = assets.filter(a => a.status === 'processing' || a.status === 'uploading').length;
          const totalStorageBytes = assets.reduce((sum, a) => sum + (a.total_storage_bytes ?? 0), 0);
          const totalDurationMs = assets.reduce((sum, a) => sum + (a.duration_ms ?? 0), 0);
          const avgDurationMs = totalAssets > 0 ? totalDurationMs / totalAssets : 0;
          const uptimeSeconds = metrics.data?.current?.uptime ?? 0;
          const uptimeStr = uptimeSeconds > 3600
            ? `${(uptimeSeconds / 3600).toFixed(1)}h`
            : uptimeSeconds > 60
              ? `${Math.floor(uptimeSeconds / 60)}m`
              : `${Math.floor(uptimeSeconds)}s`;

          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard icon={Database} label="Total Assets" value={totalAssets} />
              <MetricCard icon={Globe} label="Ready to Stream" value={readyCount} />
              <MetricCard icon={Activity} label="Processing" value={processingCount} />
              <MetricCard icon={Server} label="Storage Used" value={formatBytes(totalStorageBytes)} />
              <MetricCard icon={Clock} label="Avg Duration" value={avgDurationMs > 0 ? `${(avgDurationMs / 1000).toFixed(0)}s` : '\u2014'} />
              <MetricCard icon={Upload} label="Total Uploads" value={totalAssets} />
              <MetricCard icon={Zap} label="Uptime" value={uptimeSeconds > 0 ? uptimeStr : '\u2014'} loading={metrics.isLoading} />
              <MetricCard icon={BarChart3} label="Bandwidth" value={formatBytes(metrics.data?.current?.bandwidthBytes ?? 0)} loading={metrics.isLoading} />
            </div>
          );
        })()}
      </motion.section>

      {/* Recent Activity */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading">Recent Activity</h2>
          <p className="text-sm text-zinc-400 mt-0.5">Latest assets in the pipeline</p>
        </div>

        {recentAssets.isLoading ? (
          <RecentActivitySkeleton />
        ) : recentAssets.data && recentAssets.data.data.length > 0 ? (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
            <div className="divide-y divide-white/[0.04]">
              {recentAssets.data.data.map((asset) => (
                <Link
                  key={asset.id}
                  to={assetLink(asset)}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.05] transition-colors duration-150 group focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:outline-none rounded-2xl"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="p-2 rounded-lg bg-white/[0.04] group-hover:bg-teal-500/10 transition-colors duration-150">
                      <FileVideo className="w-4 h-4 text-zinc-400 group-hover:text-teal-400 transition-colors duration-150" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">
                        {asset.title}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5 font-mono truncate">
                        {asset.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 ml-4 shrink-0">
                    {asset.manifest_object_id && (
                      <div
                        className="hidden md:inline-flex"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ObjectIdBadge
                          value={asset.manifest_object_id}
                          truncate={6}
                          hideCopy
                          className="text-[10px]"
                        />
                      </div>
                    )}
                    <StatusBadge status={asset.status} />
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(asset.created_at)}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-teal-400 group-hover:translate-x-0.5 transition-all duration-150" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-10 text-center"
          >
            <div className="mx-auto w-10 h-10 rounded-xl bg-white/[0.05] flex items-center justify-center mb-3">
              <FileVideo className="w-6 h-6 text-zinc-500" />
            </div>
            <p className="text-sm text-zinc-400">No assets yet</p>
            <p className="text-xs text-zinc-500 mt-1">
              <Link to="/studio/upload" className="text-teal-400 hover:text-teal-300 transition-colors">
                Upload your first video
              </Link>{' '}
              to get started.
            </p>
          </motion.div>
        )}
      </motion.section>
    </PageContainer>
  );
}
