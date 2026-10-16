import { describe, expect, it } from 'vitest';
import { chunkProgress } from './chunk-progress';

const MiB = 1024 * 1024;

describe('chunkProgress', () => {
  it('counts a short final chunk as done once every byte is sent', () => {
    const p = chunkProgress(517_900, 517_900, 8 * MiB);
    expect(p).toMatchObject({ chunks: 1, done: 1 });
    expect(p.fills).toEqual([1]);
  });

  it('fills cells against real byte ranges', () => {
    const p = chunkProgress(12 * MiB, 20 * MiB, 8 * MiB);
    expect(p.chunks).toBe(3);
    expect(p.done).toBe(1);
    expect(p.fills).toEqual([1, 0.5, 0]);
  });

  it('groups chunks into at most 96 cells for large files', () => {
    const p = chunkProgress(0, 10 * 1024 * MiB, 8 * MiB);
    expect(p.chunks).toBe(1280);
    expect(p.perCell).toBe(14);
    expect(p.fills.length).toBeLessThanOrEqual(96);
  });
});
