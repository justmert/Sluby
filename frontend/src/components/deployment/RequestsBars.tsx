import { BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatCount } from '@/lib/formatters';
import type { MetricsSnapshot } from '@/lib/metrics';
import { cn } from '@/lib/utils';

/**
 * Streaming requests by file type as sideways bars, which keep the three
 * names readable on a phone. The largest is in the accent, the rest in its
 * light tone, and a hovered bar turns to the accent like the health chart.
 */
export function RequestsBars({ m, height = 'h-56' }: { m: MetricsSnapshot; height?: string }) {
  const data = [
    { kind: 'Video segments', count: m.delivery.requests.media },
    { kind: 'Playlists', count: m.delivery.requests.manifest },
    { kind: 'Other files', count: m.delivery.requests.object },
  ];
  const max = Math.max(...data.map((d) => d.count));
  if (max === 0) {
    // a smaller box, so an empty chart is not the loudest thing on the page
    return (
      <div className="grid min-h-40 w-full place-items-center">
        <EmptyState
          icon={BarChart3}
          title="Nothing streamed yet"
          description="Requests appear here when videos play through this server."
          className="py-4"
        />
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={`Streaming requests: ${data.map((d) => `${d.kind} ${formatCount(d.count)}`).join(', ')}`}
      data-slot="requests-bars"
      className={cn('flex flex-col justify-center gap-5 border-b pb-4', height)}
    >
      {data.map((d) => (
        <div key={d.kind} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3">
          <span className="text-muted-foreground">{d.kind}</span>
          <span className="h-6">
            <span
              data-slot="bar"
              data-peak={d.count === max || undefined}
              className={cn(
                'block h-full min-w-0.5 rounded-r-[4px] transition-colors duration-150 ease-(--ease-design) hover:bg-primary',
                d.count === max ? 'bg-primary' : 'bg-primary/45',
              )}
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </span>
          <span className="text-right font-semibold tabular-nums">{formatCount(d.count)}</span>
        </div>
      ))}
    </div>
  );
}
