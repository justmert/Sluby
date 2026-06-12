import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock logger
vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg-data')),
}));

// Mock sia-client
vi.mock('../storage/sia-client.js', () => ({
  uploadAndPin: vi.fn().mockResolvedValue({ objectId: 'thumb-obj-id' }),
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

import { extractAndUploadThumbnails } from '../transcode/thumbnail-extractor.js';
import { readFile } from 'node:fs/promises';
import { uploadAndPin } from '../storage/sia-client.js';

describe('thumbnail-extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: all ffmpeg calls succeed
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => {
        proc.emit('close', 0);
      });
      return proc;
    });
  });

  describe('extractAndUploadThumbnails', () => {
    it('should extract thumbnails at 25%, 50%, and 75% positions', async () => {
      const durationMs = 120_000; // 2 minutes

      await extractAndUploadThumbnails('/input/video.mp4', durationMs, '/output');

      // Should have spawned ffmpeg 3 times (once per position)
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      // Verify the time positions
      const calls = mockSpawn.mock.calls;
      // 25% of 120s = 30s
      expect(calls[0][1]).toContain('30.00');
      // 50% of 120s = 60s
      expect(calls[1][1]).toContain('60.00');
      // 75% of 120s = 90s
      expect(calls[2][1]).toContain('90.00');
    });

    it('should call ffmpeg with correct arguments', async () => {
      await extractAndUploadThumbnails('/input/video.mp4', 100_000, '/output');

      const args = mockSpawn.mock.calls[0][1] as string[];

      expect(mockSpawn.mock.calls[0][0]).toBe('ffmpeg');
      expect(args).toContain('-y');
      expect(args).toContain('-i');
      expect(args).toContain('/input/video.mp4');
      expect(args).toContain('-vframes');
      expect(args).toContain('1');
    });

    it('should read the thumbnail file and upload to Sia', async () => {
      vi.mocked(readFile).mockResolvedValue(Buffer.from('jpeg-bytes'));
      vi.mocked(uploadAndPin).mockResolvedValue({ objectId: 'uploaded-thumb-obj', size: 100 });

      await extractAndUploadThumbnails('/input/video.mp4', 60_000, '/output');

      // readFile should be called 3 times
      expect(readFile).toHaveBeenCalledTimes(3);

      // uploadAndPin should be called 3 times
      expect(uploadAndPin).toHaveBeenCalledTimes(3);
    });

    it('should return an array of object IDs', async () => {
      let callCount = 0;
      vi.mocked(uploadAndPin).mockImplementation(async () => {
        callCount++;
        return { objectId: `thumb-obj-${callCount}`, size: 100 };
      });

      const objectIds = await extractAndUploadThumbnails('/input/video.mp4', 60_000, '/output');

      expect(objectIds).toHaveLength(3);
      expect(objectIds).toEqual(['thumb-obj-1', 'thumb-obj-2', 'thumb-obj-3']);
    });

    it('should generate correct output file paths', async () => {
      await extractAndUploadThumbnails('/input/video.mp4', 100_000, '/output/thumbs');

      expect(readFile).toHaveBeenCalledWith('/output/thumbs/thumb_25.jpg');
      expect(readFile).toHaveBeenCalledWith('/output/thumbs/thumb_50.jpg');
      expect(readFile).toHaveBeenCalledWith('/output/thumbs/thumb_75.jpg');
    });

    it('should reject when ffmpeg fails for a thumbnail', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        process.nextTick(() => {
          proc.stderr.emit('data', Buffer.from('Error extracting frame'));
          proc.emit('close', 1);
        });
        return proc;
      });

      await expect(
        extractAndUploadThumbnails('/input/video.mp4', 60_000, '/output'),
      ).rejects.toThrow('Thumbnail extraction failed');
    });

    it('should reject when ffmpeg spawn fails', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        process.nextTick(() => {
          proc.emit('error', new Error('ENOENT: ffmpeg not found'));
        });
        return proc;
      });

      await expect(
        extractAndUploadThumbnails('/input/video.mp4', 60_000, '/output'),
      ).rejects.toThrow('ENOENT: ffmpeg not found');
    });
  });
});
