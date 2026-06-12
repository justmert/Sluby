import { TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  sparklineData?: number[];
  className?: string;
}

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 80;
  const height = 32;
  const padding = 2;
  const graphHeight = height - padding * 2;
  const graphWidth = width - padding * 2;

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * graphWidth;
    const y = padding + graphHeight - ((value - min) / range) * graphHeight;
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${padding + graphWidth},${height - padding} L ${padding},${height - padding} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(20, 184, 166)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="rgb(20, 184, 166)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path
        d={linePath}
        fill="none"
        stroke="rgb(20, 184, 166)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  trend,
  sparklineData,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-5 transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05] group card-glow',
        className,
      )}
    >
      {/* Subtle gradient accent on left */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-teal-500/40 via-teal-500/20 to-transparent" />

      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05]">
              <Icon className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
              {label}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl font-bold tracking-tight text-zinc-100">{value}</span>
            {trend && trend !== 'neutral' && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  trend === 'up'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-red-500/10 text-red-400',
                )}
              >
                {trend === 'up' ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
              </span>
            )}
          </div>
        </div>
        {sparklineData && sparklineData.length > 1 && (
          <div className="mt-auto opacity-60 group-hover:opacity-100 transition-opacity duration-200">
            <MiniSparkline data={sparklineData} />
          </div>
        )}
      </div>
    </div>
  );
}
