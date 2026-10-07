/** What a formatter prints for a value it cannot format (missing, NaN, negative). */
export const NO_VALUE = '-';

/**
 * Scale a value into the largest unit that keeps it under 1000. Rounding
 * happens before the unit is final, so 999_950 bytes reads "1 MB", not
 * "1000 KB". Units from `decimalsFrom` up keep one decimal, without a
 * trailing ".0".
 */
function scale(value: number, units: readonly string[], decimalsFrom: number): string {
  let i = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log10(value) / 3)));
  const round = (unit: number) => {
    const v = value / 1000 ** unit;
    return unit >= decimalsFrom && v < 100 ? Number(v.toFixed(1)) : Math.round(v);
  };
  let rounded = round(i);
  if (rounded >= 1000 && i < units.length - 1) rounded = round(++i);
  return `${rounded} ${units[i]}`;
}

/**
 * Format a byte count with decimal (SI) units, the way storage providers
 * such as sia.storage quote capacity: 50_000_000_000 -> "50 GB".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return NO_VALUE;
  // rates are fractional; anything under a byte rounds to nothing
  if (bytes < 1) return '0 B';
  return scale(bytes, ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], 1);
}

/**
 * Format a bitrate in bits per second.
 * e.g. 6_000_000 -> "6 Mbps", 800_000 -> "800 Kbps"
 */
export function formatBitrate(bps: number | undefined): string {
  if (bps === undefined || !Number.isFinite(bps) || bps < 0) return NO_VALUE;
  if (bps < 1) return '0 bps';
  return scale(bps, ['bps', 'Kbps', 'Mbps', 'Gbps'], 2);
}

/**
 * Format a duration in milliseconds as a clock.
 * e.g. 155000 -> "2:35", 3735000 -> "1:02:15"
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return NO_VALUE;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function toDate(date: string | Date): Date | null {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? null : d;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Format a date relative to now: "2 minutes ago", "in 3 days", "just now".
 * Within a minute either way reads "just now", which absorbs clock skew.
 */
export function formatRelativeTime(date: string | Date, now = Date.now()): string {
  const d = toDate(date);
  if (!d) return NO_VALUE;
  const diffMs = now - d.getTime();
  const seconds = Math.floor(Math.abs(diffMs) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const span =
    minutes < 60
      ? plural(minutes, 'minute')
      : hours < 24
        ? plural(hours, 'hour')
        : days < 30
          ? plural(days, 'day')
          : months < 12
            ? plural(months, 'month')
            : plural(Math.floor(months / 12), 'year');
  return diffMs < 0 ? `in ${span}` : `${span} ago`;
}

/** How long until `iso`, compactly: "in 5m", "in 3h 20m", "in 2d 4h", or "now" once passed. */
export function formatTimeLeft(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return NO_VALUE;
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `in ${hours}h ${minutes % 60}m`;
}

/**
 * Format a date in short human-readable form.
 * e.g. "Jan 15, 2025"
 */
export function formatDate(date: string | Date): string {
  const d = toDate(date);
  if (!d) return NO_VALUE;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Shorten a long id to its first and last `chars` characters around an ellipsis. */
export function truncateMiddle(value: string, chars: number): string {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}
