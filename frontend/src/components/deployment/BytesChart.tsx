import type { RatePoint } from '@/hooks/usePlatformMetrics';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { formatBytes } from '@/lib/formatters';
import { sampleSpan } from './health';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

const rate = (bytes: number) => `${formatBytes(bytes)}/s`;

// the reader's own clock format, with seconds: samples are 10 s apart
const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function throughputSummary(rates: RatePoint[]) {
  if (rates.length === 0) return null;
  const now = rates[rates.length - 1].bytesPerSecond;
  const peak = Math.max(...rates.map((r) => r.bytesPerSecond));
  return { now, peak };
}

/** The chart's box with a sentence in it, at the chart's own height. */
function ChartBox({ height, children }: { height: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid w-full place-items-center border-b', height)}>
      <p className="flex items-center gap-2 text-muted-foreground">{children}</p>
    </div>
  );
}

const CAPTION =
  'flex h-4.5 items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums';

/**
 * Bytes streamed per sample as bars, oldest on the left: the peak in the
 * accent, the rest in its light tone, and any bar the pointer is on in the
 * accent too. A caption row under it gives the span, the peak and now.
 */
export function BytesChart({ rates, height = 'h-40' }: { rates: RatePoint[]; height?: string }) {
  // a bar needs a rate and a rate needs two samples. the first ones come
  // within seconds, so this is loading, not an empty chart
  if (rates.length < 2) {
    return (
      <div className="flex flex-col gap-3.5">
        <ChartBox height={height}>
          <Spinner aria-hidden="true" />
          Collecting samples
        </ChartBox>
        <div aria-hidden="true" className={CAPTION} />
      </div>
    );
  }
  const { now, peak } = throughputSummary(rates)!;
  const span = sampleSpan(rates)!;
  const peakAt = peak > 0 ? rates.findIndex((r) => r.bytesPerSecond === peak) : -1;
  return (
    <div className="flex flex-col gap-3.5">
      <div
        role="img"
        aria-label={`Bytes streamed per second over the last ${span}, now ${rate(now)}, peak ${rate(peak)}`}
        data-slot="bytes-chart"
        className={cn('flex items-end gap-[clamp(1px,0.8%,6px)] border-b pb-1', height)}
      >
        {rates.map((r, i) => (
          <div
            key={r.at}
            data-slot="bar"
            data-peak={i === peakAt || undefined}
            title={`${clock(r.at)}, ${rate(r.bytesPerSecond)}`}
            className={cn(
              'min-h-0.5 flex-1 rounded-t-[4px] transition-colors duration-150 ease-(--ease-design) hover:bg-primary',
              i === peakAt ? 'bg-primary' : 'bg-primary/45',
            )}
            style={{ height: `${peak > 0 ? (r.bytesPerSecond / peak) * 100 : 0}%` }}
          />
        ))}
      </div>
      <div className={CAPTION}>
        <span>{span} ago</span>
        <span>Peak {rate(peak)}</span>
        <span>Now</span>
      </div>
    </div>
  );
}

export function BytesChartLoading({ height = 'h-40' }: { height?: string }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3.5">
      <Skeleton className={cn('w-full', height, lateReveal)} />
      <div className={CAPTION}>
        <Skeleton className={cn('h-3 w-20', lateReveal)} />
        <Skeleton className={cn('h-3 w-24', lateReveal)} />
        <Skeleton className={cn('h-3 w-16', lateReveal)} />
      </div>
    </div>
  );
}
