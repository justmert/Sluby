// wording and arithmetic the health cards share
import { useEffect, useState } from 'react';
import type { RatePoint } from '@/hooks/usePlatformMetrics';
import type { HostPool, Probe, SystemStatus } from '@/hooks/useStats';
import { formatCount, plural } from '@/lib/formatters';

/**
 * "218 ms" for a probe that answered, "Not working" for one that did not. Not
 * "not responding": the indexer also fails while its account is not ready,
 * and the reason is under Details.
 */
export function probeText(probe: Probe): string {
  return probe.ok ? `${probe.latency_ms} ms` : 'Not working';
}

export const ratio = (part: number, whole: number) =>
  whole > 0 ? Math.min(100, (part / whole) * 100) : 0;

/** "202 of 213 good for upload, 45 countries" */
export function hostsLine(hosts: HostPool | null): string | null {
  if (!hosts) return null;
  return `${formatCount(hosts.good_for_upload)} of ${formatCount(hosts.total)} good for upload, ${plural(hosts.countries, 'country', 'countries')}`;
}

/** The server's own verdict as the page head's chip says it. */
export const OVERALL: Record<SystemStatus['status'], { label: string; tone: Tone }> = {
  ok: { label: 'All services working', tone: 'ok' },
  // the backend calls it degraded when only the indexer is unhappy
  degraded: { label: 'Sia indexer needs attention', tone: 'warn' },
  // and down when the database or the queue fails
  down: { label: 'Some services are down', tone: 'bad' },
};

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

/** The host of a url, or the url itself when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** "2 s", "1 min", "3 h": how long something took. */
export function shortDuration(ms: number): string {
  if (ms < 1000) return 'under 1 s';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

/** "12 s ago", "41 min ago", "3 h ago": compact, for a line that ticks. */
export function shortAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${plural(Math.floor(h / 24), 'day')} ago`;
}

/**
 * How long the rates cover, counting the first one's own interval:
 * "20 seconds", "10 minutes".
 */
export function sampleSpan(rates: RatePoint[]): string | null {
  if (rates.length < 2) return null;
  const ms = rates[rates.length - 1].at - rates[0].at + (rates[1].at - rates[0].at);
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? plural(seconds, 'second') : plural(Math.round(seconds / 60), 'minute');
}

/** The clock, read again every `intervalMs` while the tab is visible. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
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

// the health page's grids, shared with its loading draw so nothing moves when
// the cards land. the four services sit in a row once each gets 200px, the
// two account cards once each gets 340px, and both stack below that
export const HEALTH_GRID = {
  services: 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-4',
  pair: 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,21.25rem),1fr))] gap-4',
  stack: 'flex flex-col gap-5',
} as const;
