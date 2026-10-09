import type { Usage } from '@/hooks/useUsage';
import { cn } from '@/lib/utils';

/**
 * Daily plays as a row of thin bars, the latest day in the accent. Pure
 * decoration: the stat card's figure carries the number, so this is hidden
 * from assistive tech.
 */
export function PlaysSparkline({ days, className }: { days: Usage['days']; className?: string }) {
  const max = Math.max(1, ...days.map((d) => d.plays));
  const w = 4;
  const gap = 2;
  const h = 16;
  return (
    <svg
      aria-hidden="true"
      data-slot="plays-sparkline"
      viewBox={`0 0 ${days.length * (w + gap) - gap} ${h}`}
      preserveAspectRatio="none"
      className={cn('block h-4 w-full max-w-40', className)}
    >
      {days.map((d, i) => {
        // a day without plays still gets a hairline, so the row reads as 30 days
        const bh = d.plays > 0 ? Math.max(2, (d.plays / max) * h) : 1;
        return (
          <rect
            key={d.date}
            x={i * (w + gap)}
            y={h - bh}
            width={w}
            height={bh}
            rx={1}
            className={i === days.length - 1 ? 'fill-primary' : 'fill-muted-foreground/40'}
          />
        );
      })}
    </svg>
  );
}
