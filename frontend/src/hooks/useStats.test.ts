import { describe, expect, it } from 'vitest';
import { movingCount, type AssetStats } from './useStats';

const stats = (processing: number, uploading: number): AssetStats => ({
  total: processing + uploading,
  by_status: { created: 0, uploading, processing, ready: 0, failed: 0 },
  stored_bytes: 0,
  ready_duration_ms: 0,
  object_count: 0,
});

describe('movingCount', () => {
  // an upload whose browser went away stays "uploading" until the server
  // sweeps it a day later; only one this browser sends is known to move
  it('counts processing videos and the uploads this browser is sending', () => {
    expect(movingCount(stats(2, 3), 0)).toBe(2);
    expect(movingCount(stats(2, 3), 1)).toBe(3);
  });

  it('never counts more uploads than the server has', () => {
    expect(movingCount(stats(0, 1), 4)).toBe(1);
  });
});
