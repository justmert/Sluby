import { useQuery } from '@tanstack/react-query';
import type { UsageReport } from '@sluby/sdk';
import { sluby } from '@/lib/sluby';

export type Usage = UsageReport;

/**
 * The longest window the server keeps (1 to 90 days). The overview's figure
 * and sparkline use the last 30 of them; the get started checklist asks
 * whether there was any play at all.
 */
export const USAGE_DAYS = 90;
export const PLAYS_WINDOW = 30;

/** Plays per day for the caller's account (assets.usage). */
export function useUsage() {
  return useQuery({
    queryKey: ['stats', 'usage', USAGE_DAYS],
    queryFn: ({ signal }) => sluby.assets.usage({ days: USAGE_DAYS, signal }),
    // plays are flushed every 10 s server side; a minute keeps the figure current enough
    refetchInterval: 60_000,
  });
}

/** The last `n` days of a usage answer and their sum. */
export function lastDays(usage: Usage, n = PLAYS_WINDOW): { days: Usage['days']; total: number } {
  const days = usage.days.slice(-n);
  return { days, total: days.reduce((sum, d) => sum + d.plays, 0) };
}
