import { NumberTicker } from '@/components/motion/NumberTicker';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface StatValueProps {
  /** null or undefined while loading; the skeleton has the same height as the number */
  value: number | null | undefined;
  /** turns the number into text, e.g. formatBytes; defaults to a grouped integer */
  format?: (n: number) => string;
  className?: string;
}

/**
 * The big number on a stat card. It sets its own size (the figure role:
 * 24/32 semibold, tabular digits)
 * so it does not depend on the card title, and it counts to new values
 * through NumberTicker. The loading skeleton is the number's 32px line box,
 * so nothing shifts when the value lands.
 */
export function StatValue({ value, format, className }: StatValueProps) {
  if (value === null || value === undefined) {
    return <Skeleton data-slot="stat-value" className={cn('h-8 w-20', className)} />;
  }
  return (
    <NumberTicker
      value={value}
      format={format}
      className={cn('block font-heading text-figure tabular-nums', className)}
    />
  );
}
