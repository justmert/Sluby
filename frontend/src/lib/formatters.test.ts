import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatters';

describe('formatBytes', () => {
  it('uses decimal units like storage providers', () => {
    expect(formatBytes(50_000_000_000)).toBe('50 GB');
    expect(formatBytes(1_500_000)).toBe('1.5 MB');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(123_456_789)).toBe('123 MB');
    expect(formatBytes(0)).toBe('0 B');
  });
});
