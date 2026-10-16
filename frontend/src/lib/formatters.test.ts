import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatBitrate,
  formatBytes,
  formatCount,
  formatDate,
  formatDuration,
  formatRatio,
  formatRelativeTime,
  formatResolution,
  formatTimeLeft,
  formatUptime,
  plural,
  truncateMiddle,
} from './formatters';

describe('formatBytes', () => {
  it('uses decimal units like storage providers', () => {
    expect(formatBytes(50_000_000_000)).toBe('50 GB');
    expect(formatBytes(1_500_000)).toBe('1.5 MB');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(123_456_789)).toBe('123 MB');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('never prints an undefined unit for fractional rates', () => {
    expect(formatBytes(0.3)).toBe('0 B');
    expect(formatBytes(0.5)).toBe('0 B');
    expect(formatBytes(1.4)).toBe('1 B');
  });

  it('moves to the next unit when rounding reaches 1000', () => {
    expect(formatBytes(999_950)).toBe('1 MB');
    expect(formatBytes(999_499)).toBe('999 KB');
    expect(formatBytes(1_999_999_999)).toBe('2 GB');
  });

  it('shows a placeholder for input it cannot format', () => {
    expect(formatBytes(NaN)).toBe('–');
    expect(formatBytes(-5)).toBe('–');
    expect(formatBytes(Infinity)).toBe('–');
  });
});

describe('formatBitrate', () => {
  it('formats whole and fractional rates', () => {
    expect(formatBitrate(6_000_000)).toBe('6 Mbps');
    expect(formatBitrate(800_000)).toBe('800 kbps');
    expect(formatBitrate(2_500_000)).toBe('2.5 Mbps');
    expect(formatBitrate(500)).toBe('500 bps');
  });

  it('rounds before picking the unit and drops a trailing .0', () => {
    expect(formatBitrate(999_999)).toBe('1 Mbps');
    expect(formatBitrate(1_999_999)).toBe('2 Mbps');
    expect(formatBitrate(500.5)).toBe('501 bps');
  });

  it('shows a placeholder for a missing bitrate', () => {
    expect(formatBitrate(NaN)).toBe('–');
    expect(formatBitrate(undefined)).toBe('–');
    expect(formatBitrate(-1)).toBe('–');
  });
});

describe('formatDuration', () => {
  it('formats a clock', () => {
    expect(formatDuration(155_000)).toBe('2:35');
    expect(formatDuration(3_735_000)).toBe('1:02:15');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('shows a placeholder for negative or invalid input', () => {
    expect(formatDuration(-5000)).toBe('–');
    expect(formatDuration(NaN)).toBe('–');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');

  it('describes the past', () => {
    expect(formatRelativeTime('2026-10-07T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-07T11:58:00Z', now)).toBe('2 minutes ago');
    expect(formatRelativeTime('2026-10-07T11:00:00Z', now)).toBe('1 hour ago');
    expect(formatRelativeTime('2026-10-04T12:00:00Z', now)).toBe('3 days ago');
    expect(formatRelativeTime('2024-10-07T12:00:00Z', now)).toBe('2 years ago');
  });

  it('describes the future instead of calling it just now', () => {
    expect(formatRelativeTime('2026-10-07T12:00:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-07T12:05:00Z', now)).toBe('in 5 minutes');
    expect(formatRelativeTime('2026-10-09T12:00:00Z', now)).toBe('in 2 days');
  });

  it('shows a placeholder for an invalid date', () => {
    expect(formatRelativeTime('not a date', now)).toBe('–');
  });
});

describe('formatDate', () => {
  it('formats a short date and refuses invalid input', () => {
    expect(formatDate('2025-01-15T12:00:00Z')).toBe('Jan 15, 2025');
    expect(formatDate('not a date')).toBe('–');
  });
});

describe('truncateMiddle', () => {
  it('keeps short values and shortens long ones', () => {
    expect(truncateMiddle('abcdef', 4)).toBe('abcdef');
    expect(truncateMiddle('0123456789abcdef0123', 4)).toBe('0123…0123');
  });
});

describe('counts and plurals', () => {
  it('groups thousands the english way and picks the plural', () => {
    expect(formatCount(12345)).toBe('12,345');
    expect(plural(1, 'video')).toBe('1 video');
    expect(plural(1204, 'file')).toBe('1,204 files');
    expect(plural(2, 'country', 'countries')).toBe('2 countries');
    expect(plural(1, 'country', 'countries')).toBe('1 country');
  });
});

describe('formatResolution and formatRatio', () => {
  it('uses a times sign', () => {
    expect(formatResolution(1920, 1080)).toBe('1920 × 1080');
    expect(formatResolution('1280x720')).toBe('1280 × 720');
    expect(formatResolution(null)).toBe('–');
    expect(formatRatio(3)).toBe('3×');
    expect(formatRatio(2.46)).toBe('2.5×');
  });
});

describe('formatUptime, formatTimeLeft and formatAgo', () => {
  it('writes durations in words', () => {
    expect(formatUptime(8 * 60_000 + 35_000)).toBe('8 minutes');
    expect(formatUptime((3 * 60 + 20) * 60_000)).toBe('3 hours 20 minutes');
    expect(formatUptime(2 * 3_600_000)).toBe('2 hours');
    expect(formatUptime((4 * 24 + 2) * 3_600_000)).toBe('4 days 2 hours');
    expect(formatUptime(30_000)).toBe('less than a minute');
  });

  it('says how long is left in words', () => {
    const at = (ms: number) => new Date(1_000_000 + ms).toISOString();
    expect(formatTimeLeft(at(59 * 60_000 + 30_000), 1_000_000)).toBe('in 1 hour');
    expect(formatTimeLeft(at(5 * 60_000), 1_000_000)).toBe('in 5 minutes');
    expect(formatTimeLeft(at(26 * 3_600_000), 1_000_000)).toBe('in 1 day 2 hours');
    expect(formatTimeLeft(at(-1), 1_000_000)).toBe('now');
  });

  it('says how long ago a live figure updated', () => {
    expect(formatAgo(2_000)).toBe('just now');
    expect(formatAgo(12_000)).toBe('12 seconds ago');
    expect(formatAgo(60_000)).toBe('1 minute ago');
    expect(formatAgo(3 * 3_600_000)).toBe('3 hours ago');
  });
});
