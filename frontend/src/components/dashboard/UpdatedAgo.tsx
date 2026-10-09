import { useEffect, useState } from 'react';
import { formatAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      // a hidden tab has nothing to show, and the next visible tick catches up
      if (!document.hidden) setNow(Date.now());
    };
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs]);
  return now;
}

interface UpdatedAgoProps {
  /** when the data on screen arrived, as react query's dataUpdatedAt; 0 before any */
  updatedAt: number;
  /**
   * the data itself. react query keeps the same object when a refetch brings
   * the same figures, so the dot pops only when this changes, not on every poll
   */
  data?: unknown;
  /** the latest refresh failed, so the figures are getting old */
  stale?: boolean;
  /** what came in, e.g. "Totals updated" */
  label?: string;
  className?: string;
}

/**
 * A quiet live indicator: how long ago the figures arrived, and a dot that
 * pops once when they change.
 */
export function UpdatedAgo({
  updatedAt,
  data,
  stale = false,
  label = 'Updated',
  className,
}: UpdatedAgoProps) {
  const now = useNow(1000);
  // how many times the figures changed while on screen; the first reading is the page load, not news
  const [seen, setSeen] = useState<{ data: unknown; changes: number }>({ data, changes: 0 });
  if (!Object.is(seen.data, data)) {
    setSeen({ data, changes: seen.data === undefined ? 0 : seen.changes + 1 });
  }
  // the line is there before the first answer, so it does not push anything when it fills
  if (!updatedAt) return <p aria-hidden="true" className={cn('h-4', className)} />;
  return (
    <p
      className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}
      title={new Date(updatedAt).toLocaleString()}
    >
      <span
        key={seen.changes}
        aria-hidden="true"
        data-slot="updated-dot"
        data-stale={stale || undefined}
        className={cn(
          'size-1.5 shrink-0 rounded-full bg-success transition-colors duration-200 data-stale:bg-warning',
          seen.changes > 0 &&
            'animate-in duration-300 ease-out-soft fade-in-30 zoom-in-0 transition-none',
        )}
      />
      <span className="tabular-nums">
        {label} {formatAgo(now - updatedAt)}
        {stale && ', could not refresh'}
      </span>
    </p>
  );
}
