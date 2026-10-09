import { useQuery } from '@tanstack/react-query';
import { apiClient, statusOf } from '@/lib/api-client';

/** GET /stats/usage: plays of the caller's videos per UTC day, oldest first, zero-filled. */
export interface Usage {
  days: { date: string; plays: number }[];
  total: number;
}

/**
 * The longest window the server keeps (B-09 allows 1 to 90 days). The
 * overview's figure and sparkline use the last 30 of them; the get started
 * checklist asks whether there was any play at all, which a 90 day window
 * answers for an account that is still setting up.
 */
export const USAGE_DAYS = 90;
export const PLAYS_WINDOW = 30;

/**
 * Plays per day for the caller's account. `null` when the server does not
 * count plays (it answers 404 for the route: a server from before B-09).
 */
export function useUsage() {
  return useQuery({
    queryKey: ['stats', 'usage', USAGE_DAYS],
    queryFn: async ({ signal }): Promise<Usage | null> => {
      try {
        return await apiClient.get<Usage>(`/stats/usage?days=${USAGE_DAYS}`, { signal });
      } catch (err) {
        if (statusOf(err) === 404) return null;
        throw err;
      }
    },
    // plays are flushed every 10 s server side; a minute keeps the figure current enough
    refetchInterval: 60_000,
  });
}

/** The last `n` days of a usage answer and their sum. */
export function lastDays(usage: Usage, n = PLAYS_WINDOW): { days: Usage['days']; total: number } {
  const days = usage.days.slice(-n);
  return { days, total: days.reduce((sum, d) => sum + d.plays, 0) };
}
