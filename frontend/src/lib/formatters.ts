/**
 * Format a byte count into a human-readable string.
 * e.g. 1_500_000_000 -> "1.5 GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/**
 * Format duration in milliseconds to a human-readable time string.
 * e.g. 155000 -> "2:35", 3735000 -> "1:02:15"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format a bitrate in bits per second.
 * e.g. 6_000_000 -> "6 Mbps", 800_000 -> "800 Kbps"
 */
export function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) {
    const mbps = bps / 1_000_000;
    return `${mbps % 1 === 0 ? mbps : mbps.toFixed(1)} Mbps`;
  }
  if (bps >= 1_000) {
    const kbps = bps / 1_000;
    return `${kbps % 1 === 0 ? kbps : kbps.toFixed(0)} Kbps`;
  }
  return `${bps} bps`;
}

/**
 * Format a date as a relative time string.
 * e.g. "2 minutes ago", "3 days ago", "just now"
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Format a date in short human-readable form.
 * e.g. "Jan 15, 2025"
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a blockchain address, truncating the middle.
 * e.g. "0x1234567890abcdef..." -> "0x1234...abcd"
 */
export function formatAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Mask an API key for display.
 * e.g. "sluby_abc123def456" -> "sluby_****...f456"
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return key;
  const last4 = key.slice(-4);
  return `sluby_****...${last4}`;
}
