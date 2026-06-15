import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockProcess() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  return proc;
}

const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { extractThumbnails } from '../transcode/thumbnail-extractor.js';

describe('extractThumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => {
        proc.emit('close', 0);
      });
      return proc;
    });
  });

  it('extracts at 25%, 50%, 75% positions', async () => {
    const durationMs = 120_000;
    await extractThumbnails('/input/video.mp4', durationMs, '/output');

    expect(mockSpawn).toHaveBeenCalledTimes(3);
    const calls = mockSpawn.mock.calls;
    expect(calls[0][1]).toContain('30.00');
    expect(calls[1][1]).toContain('60.00');
    expect(calls[2][1]).toContain('90.00');
  });

  it('calls ffmpeg with correct args', async () => {
    await extractThumbnails('/input/video.mp4', 100_000, '/output');
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(mockSpawn.mock.calls[0][0]).toBe('ffmpeg');
    expect(args).toContain('-y');
    expect(args).toContain('-i');
    expect(args).toContain('/input/video.mp4');
    expect(args).toContain('-vframes');
    expect(args).toContain('1');
  });

  it('returns the local file paths it wrote to', async () => {
    const paths = await extractThumbnails(
      '/input/video.mp4',
      100_000,
      '/output/thumbs',
    );
    expect(paths).toEqual([
      '/output/thumbs/thumb_25.jpg',
      '/output/thumbs/thumb_50.jpg',
      '/output/thumbs/thumb_75.jpg',
    ]);
  });

  it('rejects when ffmpeg fails', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => {
        proc.stderr.emit('data', Buffer.from('Error extracting frame'));
        proc.emit('close', 1);
      });
      return proc;
    });

    await expect(
      extractThumbnails('/input/video.mp4', 60_000, '/output'),
    ).rejects.toThrow('Thumbnail extraction failed');
  });

  it('rejects when ffmpeg spawn fails', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => {
        proc.emit('error', new Error('ENOENT: ffmpeg not found'));
      });
      return proc;
    });

    await expect(
      extractThumbnails('/input/video.mp4', 60_000, '/output'),
    ).rejects.toThrow('ENOENT: ffmpeg not found');
  });
});
