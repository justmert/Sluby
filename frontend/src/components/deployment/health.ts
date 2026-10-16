// wording and arithmetic the health cards share
import type { HostPool, Probe } from '@/hooks/useStats';
import { formatCount, plural } from '@/lib/formatters';

/** "218 ms" for a probe that answered, "Not responding" for one that did not. */
export function probeText(probe: Probe): string {
  return probe.ok ? `${probe.latency_ms} ms` : 'Not responding';
}

/** The health of one probe for StatusBadge kind="health". */
export const probeHealth = (probe: Probe) => (probe.ok ? 'ok' : 'down');

export const ratio = (part: number, whole: number) =>
  whole > 0 ? Math.min(100, (part / whole) * 100) : 0;

export function hostsLine(hosts: HostPool | null): string | null {
  if (!hosts) return null;
  return `${formatCount(hosts.good_for_upload)} of ${formatCount(hosts.total)} accept uploads, in ${plural(hosts.countries, 'country', 'countries')}`;
}

// the health page's grid, shared with its loading draw so nothing moves when the cards land
export const HEALTH_GRID = {
  top: 'grid gap-4 @3xl/page:grid-cols-2',
  row: 'mt-4',
} as const;
