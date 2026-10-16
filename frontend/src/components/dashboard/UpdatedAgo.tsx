import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { agoText } from './live';

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
  /** the latest refresh failed, so the figures are getting old */
  stale?: boolean;
  /** what came in, e.g. "Totals updated" */
  label?: string;
  className?: string;
}

/**
 * A quiet live indicator: a dot that pops once each time fresh data lands,
 * and how long ago that was.
 */
export function UpdatedAgo({
  updatedAt,
  stale = false,
  label = 'Updated',
  className,
}: UpdatedAgoProps) {
  const now = useNow(1000);
  // the first reading is the page load, not news
  const [firstAt] = useState(updatedAt);
  // the line is there before the first answer, so it does not push anything when it fills
  if (!updatedAt) return <p aria-hidden="true" className={cn('h-4', className)} />;
  return (
    <p
      className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}
      title={new Date(updatedAt).toLocaleString()}
    >
      <span
        key={updatedAt}
        aria-hidden="true"
        data-stale={stale || undefined}
        className={cn(
          'size-1.5 shrink-0 rounded-full bg-success transition-colors duration-200 data-stale:bg-warning',
          updatedAt !== firstAt && 'animate-in duration-500 ease-out-soft fade-in-30 zoom-in-0',
        )}
      />
      <span className="tabular-nums">
        {label} {agoText(now - updatedAt)}
        {stale && ', refresh failed'}
      </span>
    </p>
  );
}
