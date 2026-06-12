import { useState } from 'react';
import {
  Database, Upload, Globe, Server, Clock, BarChart3, Activity, Zap,
  HardDrive, ChevronDown, ChevronUp, Loader2, XCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/layout/PageContainer';
import { useMetrics } from '@/hooks/useMetrics';
import { useCacheStats } from '@/hooks/useCacheStats';
import { useAssets } from '@/hooks/useAssets';
import { formatBytes } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFRESH_OPTIONS = [
  { label: 'Off', value: '0' },
  { label: '5s', value: '5000' },
  { label: '15s', value: '15000' },
  { label: '30s', value: '30000' },
];

const STATUS_COLORS = {
  created: '#71717a',
  processing: '#f59e0b',
  ready: '#10b981',
  failed: '#ef4444',
};

const TIER_COLORS = {
  public: '#14b8a6',
  private: '#8b5cf6',
  ppv: '#f59e0b',
  subscription: '#10b981',
};

// ---------------------------------------------------------------------------
// Sparkline Component
// ---------------------------------------------------------------------------

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((value, i) => ({ i, value }));
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#spark-${color})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// MetricCard with sparkline
// ---------------------------------------------------------------------------

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sparkData?: number[];
  sparkColor?: string;
}

function MetricCard({ icon: Icon, label, value, sparkData, sparkColor = '#14b8a6' }: MetricCardProps) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 space-y-2 hover:bg-white/[0.05] transition-all duration-200">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-white/[0.04]">
          <Icon className="w-3.5 h-3.5 text-zinc-400" />
        </div>
        <span className="text-xs text-zinc-400 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-zinc-100 tabular-nums">{value}</p>
      {sparkData && sparkData.length > 1 && (
        <Sparkline data={sparkData} color={sparkColor} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut Chart
// ---------------------------------------------------------------------------

interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

function DonutChart({ data, centerLabel }: { data: DonutSlice[]; centerLabel?: string }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            isAnimationActive={false}
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px',
              fontSize: '12px',
              color: '#f0f0f0',
              padding: '8px 12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
            itemStyle={{ color: '#e4e4e7', padding: 0 }}
            formatter={(value: number, name: string) => [`${value.toLocaleString()} (${total > 0 ? Math.round((value / total) * 100) : 0}%)`, name]}
          />
        </PieChart>
      </ResponsiveContainer>
      {centerLabel && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-zinc-100">{centerLabel}</span>
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-3 mt-2">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-[10px] text-zinc-400">{d.name}</span>
            <span className="text-[10px] text-zinc-500 tabular-nums">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [refreshInterval, setRefreshInterval] = useState('15000');
  const interval = parseInt(refreshInterval) || false;
  const metrics = useMetrics(interval as number | false);
  const cacheStats = useCacheStats(interval as number | false);
  const [rawExpanded, setRawExpanded] = useState(false);

  // Fetch real asset counts by access tier (must be before early returns per React rules)
  const publicAssets = useAssets({ accessTier: 'public', limit: 1 });
  const privateAssets = useAssets({ accessTier: 'private', limit: 1 });
  const ppvAssets = useAssets({ accessTier: 'pay_per_view', limit: 1 });
  const subAssets = useAssets({ accessTier: 'subscription', limit: 1 });
  const allAssets = useAssets({ limit: 100 });

  const m = metrics.data;

  if (metrics.isLoading) {
    return (
      <PageContainer>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </PageContainer>
    );
  }

  if (metrics.isError || !m) {
    return (
      <PageContainer>
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl flex flex-col items-center justify-center py-16 text-center">
          <XCircle className="w-8 h-8 text-zinc-500 mb-3" />
          <p className="text-sm font-medium text-zinc-300">Failed to load metrics</p>
          <p className="text-xs text-zinc-500 mt-1">Check that the backend is running and try again</p>
        </div>
      </PageContainer>
    );
  }

  const current = m.current;

  // Safe accessors to prevent "Cannot read properties of undefined" crashes
  const safeNum = (v: number | undefined | null): number => v ?? 0;

  const tierCounts = {
    public: publicAssets.data?.total ?? 0,
    private: privateAssets.data?.total ?? 0,
    ppv: ppvAssets.data?.total ?? 0,
    subscription: subAssets.data?.total ?? 0,
  };

  // Derive REAL counts from the database via assets API
  const dbAssets = allAssets.data?.data ?? [];
  const dbTotalAssets = allAssets.data?.total ?? 0;
  const dbReadyCount = dbAssets.filter(a => a.status === 'ready').length;
  const dbProcessingCount = dbAssets.filter(a => a.status === 'processing' || a.status === 'uploading').length;
  const dbCreatedCount = dbAssets.filter(a => a.status === 'created').length;
  const dbFailedCount = dbAssets.filter(a => a.status === 'failed').length;
  const dbTotalStorage = dbAssets.reduce((sum, a) => sum + (a.total_storage_bytes ?? 0), 0);

  // Data for distribution charts -- from real DB data
  const statusDistribution: DonutSlice[] = [
    { name: 'Created', value: dbCreatedCount, color: STATUS_COLORS.created },
    { name: 'Processing', value: dbProcessingCount, color: STATUS_COLORS.processing },
    { name: 'Ready', value: dbReadyCount, color: STATUS_COLORS.ready },
    { name: 'Failed', value: dbFailedCount, color: STATUS_COLORS.failed },
  ];

  const tierDistribution: DonutSlice[] = [
    { name: 'Public', value: tierCounts.public, color: TIER_COLORS.public },
    { name: 'Private', value: tierCounts.private, color: TIER_COLORS.private },
    { name: 'PPV', value: tierCounts.ppv, color: TIER_COLORS.ppv },
    { name: 'Subscription', value: tierCounts.subscription, color: TIER_COLORS.subscription },
  ];

  return (
    <PageContainer>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#f0f0f0] font-heading mb-1">System Metrics</h1>
            <p className="text-sm text-zinc-400">Real-time platform metrics and performance analytics</p>
          </div>
          <div className="flex items-center gap-2">
            {interval && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
            <Select value={refreshInterval} onValueChange={setRefreshInterval}>
              <SelectTrigger className="w-24 h-9 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-6">
          {/* Section 1: Overview Metrics */}
          <section>
            <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-4">Overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard icon={Database} label="Total Assets" value={dbTotalAssets} sparkColor="#14b8a6" />
              <MetricCard icon={Globe} label="Ready to Stream" value={dbReadyCount} sparkColor="#10b981" />
              <MetricCard icon={Activity} label="Processing" value={dbProcessingCount} sparkColor="#f59e0b" />
              <MetricCard icon={Server} label="Storage Used" value={formatBytes(dbTotalStorage)} sparkColor="#8b5cf6" />
              <MetricCard icon={Upload} label="Total Uploads" value={dbTotalAssets} sparkColor="#14b8a6" />
              <MetricCard icon={Zap} label="Failed" value={dbFailedCount} sparkColor="#ef4444" />
              <MetricCard icon={Clock} label="Avg Duration" value={dbTotalAssets > 0 ? `${(dbAssets.reduce((sum, a) => sum + (a.duration_ms ?? 0), 0) / dbTotalAssets / 1000).toFixed(0)}s` : '\u2014'} sparkColor="#f59e0b" />
              <MetricCard icon={BarChart3} label="Total Duration" value={(() => { const totalMs = dbAssets.reduce((sum, a) => sum + (a.duration_ms ?? 0), 0); return totalMs > 0 ? `${(totalMs / 60000).toFixed(1)}m` : '\u2014'; })()} sparkColor="#8b5cf6" />
            </div>
          </section>

          {/* Section 2: Distribution */}
          <section>
            <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-4">Distribution</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-[#f0f0f0] font-heading mb-3">Asset Status Distribution</h3>
                <DonutChart data={statusDistribution} />
              </div>
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-[#f0f0f0] font-heading mb-3">Access Tier Distribution</h3>
                <DonutChart data={tierDistribution} />
              </div>
            </div>
          </section>

          {/* Section 3: System Info */}
          <section>
            <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-4">System Info</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-5 py-4">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Uptime</p>
                <p className="text-lg font-bold text-zinc-100 tabular-nums">
                  {(() => { const s = safeNum(current.uptime); return s > 3600 ? `${(s/3600).toFixed(1)}h` : s > 60 ? `${Math.floor(s/60)}m` : `${Math.floor(s)}s`; })()}
                </p>
              </div>
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-5 py-4">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Created Assets</p>
                <p className="text-lg font-bold text-zinc-100 tabular-nums">{dbCreatedCount}</p>
              </div>
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-5 py-4">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Success Rate</p>
                <p className="text-lg font-bold text-emerald-400 tabular-nums">
                  {dbTotalAssets > 0 ? `${((dbReadyCount / dbTotalAssets) * 100).toFixed(0)}%` : '\u2014'}
                </p>
              </div>
            </div>
          </section>

          {/* Section 4: Delivery Cache Live */}
          {cacheStats.data && (
            <section>
              <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-4">Delivery Cache Live</h2>
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <HardDrive className="w-4 h-4 text-teal-400" />
                  <span className="text-sm font-semibold text-[#f0f0f0] font-heading">Live Stats</span>
                  {interval && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Hits</p>
                    <p className="text-lg font-bold text-emerald-400 tabular-nums mt-0.5">{safeNum(cacheStats.data?.hits).toLocaleString()}</p>
                  </div>
                  <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Misses</p>
                    <p className="text-lg font-bold text-amber-400 tabular-nums mt-0.5">{safeNum(cacheStats.data?.misses).toLocaleString()}</p>
                  </div>
                  <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Hit Rate</p>
                    <p className="text-lg font-bold text-zinc-100 tabular-nums mt-0.5">
                      {(safeNum(cacheStats.data?.hits) + safeNum(cacheStats.data?.misses)) > 0
                        ? ((safeNum(cacheStats.data?.hits) / (safeNum(cacheStats.data?.hits) + safeNum(cacheStats.data?.misses))) * 100).toFixed(1)
                        : '0.0'}%
                    </p>
                  </div>
                  <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Entries</p>
                    <p className="text-lg font-bold text-zinc-100 tabular-nums mt-0.5">{safeNum(cacheStats.data?.entries).toLocaleString()}</p>
                  </div>
                  <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Cache Size</p>
                    <p className="text-lg font-bold text-zinc-100 mt-0.5">{formatBytes(safeNum(cacheStats.data?.size))}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Section 5: Raw Prometheus Metrics */}
          {current.raw?.length > 0 && (
            <section>
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
                <button
                  onClick={() => setRawExpanded(!rawExpanded)}
                  className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#f0f0f0] font-heading">Raw Prometheus Metrics</span>
                    <Badge variant="secondary">{current.raw?.length ?? 0} metrics</Badge>
                  </div>
                  {rawExpanded ? (
                    <ChevronUp className="w-4 h-4 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-400" />
                  )}
                </button>
                {rawExpanded && (
                  <div className="overflow-x-auto border-t border-white/[0.08]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.08] text-left bg-white/[0.01]">
                          <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">Name</th>
                          <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">Type</th>
                          <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">Help</th>
                          <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.raw.map((metric) => (
                          <tr key={metric.name} className="border-b border-white/[0.04] hover:bg-white/[0.05] transition-colors">
                            <td className="px-4 py-3 font-mono text-xs text-zinc-300">{metric.name}</td>
                            <td className="px-4 py-3">
                              <Badge variant="secondary" className="text-[10px]">{metric.type}</Badge>
                            </td>
                            <td className="px-4 py-3 text-xs text-zinc-500">{metric.help}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-zinc-200 tabular-nums">
                              {(metric.value ?? 0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </motion.div>
    </PageContainer>
  );
}
