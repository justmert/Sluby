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

// Mock fs/promises mkdir
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Creates a mock child process with stdout/stderr as simple EventEmitters.
 * The source code uses `.on('data', ...)` so EventEmitters suffice.
 */
function createMockProcess() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { end: vi.fn() },
  });
  return proc;
}

// Mock child_process.spawn
const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { transcode } from '../transcode/ffmpeg-runner.js';
import { mkdir } from 'node:fs/promises';

describe('ffmpeg-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper: set up mockSpawn to handle ffprobe (call 1) and ffmpeg (call 2).
   * ffprobe emits stdout JSON and closes with code 0.
   * ffmpeg optionally emits stderr for progress and closes with code 0.
   */
  function setupSuccessfulTranscode(opts?: {
    probeOutput?: object;
    ffmpegStderrChunks?: string[];
    ffmpegExitCode?: number;
    probeExitCode?: number;
  }) {
    let callCount = 0;
    const probeOutput = opts?.probeOutput ?? {
      format: { duration: '60.0' },
      streams: [{ codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '24/1' }],
    };

    mockSpawn.mockImplementation(() => {
      callCount++;
      const proc = createMockProcess();

      if (callCount === 1) {
        // ffprobe
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(JSON.stringify(probeOutput)));
          process.nextTick(() => {
            proc.emit('close', opts?.probeExitCode ?? 0);
          });
        });
      } else {
        // ffmpeg
        process.nextTick(() => {
          if (opts?.ffmpegStderrChunks) {
            let chain = Promise.resolve();
            for (const chunk of opts.ffmpegStderrChunks) {
              chain = chain.then(
                () =>
                  new Promise<void>((resolve) => {
                    proc.stderr.emit('data', Buffer.from(chunk));
                    process.nextTick(resolve);
                  }),
              );
            }
            chain.then(() => {
              proc.emit('close', opts?.ffmpegExitCode ?? 0);
            });
          } else {
            proc.emit('close', opts?.ffmpegExitCode ?? 0);
          }
        });
      }

      return proc;
    });
  }

  describe('transcode', () => {
    it('should create the output directory', async () => {
      setupSuccessfulTranscode();

      await transcode('/input/video.mp4', '/output/dir');

      expect(mkdir).toHaveBeenCalledWith('/output/dir', { recursive: true });
    });

    it('should call ffprobe to probe the video first', async () => {
      setupSuccessfulTranscode({
        probeOutput: {
          format: { duration: '120.5' },
          streams: [{ codec_type: 'video', width: 1280, height: 720, r_frame_rate: '30/1' }],
        },
      });

      await transcode('/input/video.mp4', '/output/dir');

      // First spawn call should be ffprobe
      expect(mockSpawn.mock.calls[0][0]).toBe('ffprobe');
      expect(mockSpawn.mock.calls[0][1]).toContain('/input/video.mp4');
    });

    it('should call ffmpeg with correct output settings', async () => {
      setupSuccessfulTranscode();

      await transcode('/input/video.mp4', '/output/dir');

      // Second spawn call should be ffmpeg
      expect(mockSpawn.mock.calls[1][0]).toBe('ffmpeg');
      const args = mockSpawn.mock.calls[1][1] as string[];

      expect(args).toContain('-i');
      expect(args).toContain('/input/video.mp4');
      expect(args).toContain('-f');
      expect(args).toContain('hls');
      expect(args).toContain('-hls_segment_type');
      expect(args).toContain('fmp4');
      expect(args).toContain('-master_pl_name');
      expect(args).toContain('master.m3u8');
    });

    it('should return correct TranscodeResult on success', async () => {
      setupSuccessfulTranscode({
        probeOutput: {
          format: { duration: '120.0' },
          streams: [{ codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '24/1' }],
        },
      });

      const result = await transcode('/input/video.mp4', '/output/dir');

      expect(result.masterPlaylistPath).toBe('/output/dir/master.m3u8');
      expect(result.variantDirs).toHaveLength(4);
      expect(result.variantDirs).toContain('/output/dir/1080p');
      expect(result.variantDirs).toContain('/output/dir/720p');
      expect(result.variantDirs).toContain('/output/dir/540p');
      expect(result.variantDirs).toContain('/output/dir/360p');
      expect(result.durationMs).toBe(120000);
      expect(result.resolution).toBe('1920x1080');
    });

    it('should reject when ffprobe fails', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        process.nextTick(() => {
          proc.stderr.emit('data', Buffer.from('Error reading input'));
          proc.emit('close', 1);
        });
        return proc;
      });

      await expect(transcode('/bad/video.mp4', '/output')).rejects.toThrow(
        'ffprobe exited with code 1',
      );
    });

    it('should reject when ffmpeg exits with non-zero code', async () => {
      setupSuccessfulTranscode({ ffmpegExitCode: 1 });

      await expect(transcode('/input/video.mp4', '/output')).rejects.toThrow(
        'FFmpeg exited with code 1',
      );
    });

    it('should reject when ffprobe finds no video stream', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        process.nextTick(() => {
          proc.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                format: { duration: '60.0' },
                streams: [{ codec_type: 'audio' }],
              }),
            ),
          );
          process.nextTick(() => {
            proc.emit('close', 0);
          });
        });
        return proc;
      });

      await expect(transcode('/audio-only.mp4', '/output')).rejects.toThrow(
        'No video stream found',
      );
    });

    it('should reject when ffmpeg spawn errors', async () => {
      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        const proc = createMockProcess();

        if (callCount === 1) {
          // ffprobe succeeds
          process.nextTick(() => {
            proc.stdout.emit(
              'data',
              Buffer.from(
                JSON.stringify({
                  format: { duration: '60.0' },
                  streams: [
                    { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '24/1' },
                  ],
                }),
              ),
            );
            process.nextTick(() => {
              proc.emit('close', 0);
            });
          });
        } else {
          // ffmpeg spawn error
          process.nextTick(() => {
            proc.emit('error', new Error('ENOENT: ffmpeg not found'));
          });
        }

        return proc;
      });

      await expect(transcode('/input/video.mp4', '/output')).rejects.toThrow('FFmpeg spawn error');
    });

    it('should parse progress from stderr when onProgress callback is provided', async () => {
      const progressValues: number[] = [];

      setupSuccessfulTranscode({
        ffmpegStderrChunks: [
          'frame=100 fps=25 time=00:00:30.00 bitrate=5000.0kbits/s',
          'frame=200 fps=25 time=00:01:00.00 bitrate=5000.0kbits/s',
        ],
      });

      await transcode('/input/video.mp4', '/output', {
        onProgress: (percent) => {
          progressValues.push(percent);
        },
      });

      expect(progressValues.length).toBeGreaterThan(0);
      // 30s out of 60s = 50%
      expect(progressValues).toContain(50);
      // 60s out of 60s = 100%
      expect(progressValues).toContain(100);
    });

    it('should create variant directories', async () => {
      setupSuccessfulTranscode();

      await transcode('/input/video.mp4', '/output/dir');

      // mkdir called for output dir + 4 variant dirs
      expect(mkdir).toHaveBeenCalledWith('/output/dir', { recursive: true });
      expect(mkdir).toHaveBeenCalledWith('/output/dir/1080p', { recursive: true });
      expect(mkdir).toHaveBeenCalledWith('/output/dir/720p', { recursive: true });
      expect(mkdir).toHaveBeenCalledWith('/output/dir/540p', { recursive: true });
      expect(mkdir).toHaveBeenCalledWith('/output/dir/360p', { recursive: true });
    });
  });
});
