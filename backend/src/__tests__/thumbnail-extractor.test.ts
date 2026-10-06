import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { logger } = vi.hoisted(() => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/logger.js', () => ({ logger }));

// size of each file "written", by path; a missing entry is a missing file
const written = new Map<string, number>();
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(async (file: string) => {
    const size = written.get(file);
    if (size === undefined) throw new Error(`ENOENT: no such file, stat '${file}'`);
    return { size };
  }),
}));

function createMockProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { extractThumbnails } from '../transcode/thumbnail-extractor.js';

const PROBE = {
  format: { duration: '120.0' },
  streams: [
    { index: 0, codec_type: 'audio', duration: '120.0' },
    { index: 1, codec_type: 'video', width: 1920, height: 1080, duration: '120.0' },
  ],
};

/**
 * ffprobe answers with `probe`; each ffmpeg call writes its output file with
 * the size `sizes` gives for its turn (undefined writes nothing) and exits
 * with the matching code.
 */
function setup(
  opts: {
    probe?: object;
    probeCode?: number;
    sizes?: (number | undefined)[];
    codes?: number[];
  } = {},
) {
  let shot = 0;
  mockSpawn.mockImplementation((command: string, args: string[]) => {
    const proc = createMockProcess();
    if (command === 'ffprobe') {
      process.nextTick(() => {
        if (opts.probeCode) {
          proc.stderr.emit('data', Buffer.from('Invalid data found when processing input\n'));
        } else {
          proc.stdout.emit('data', Buffer.from(JSON.stringify(opts.probe ?? PROBE)));
        }
        proc.emit('close', opts.probeCode ?? 0, null);
      });
      return proc;
    }
    const i = shot++;
    const code = opts.codes?.[i] ?? 0;
    const size = opts.sizes ? opts.sizes[i] : 1000;
    process.nextTick(() => {
      if (size !== undefined) written.set(args[args.length - 1], size);
      if (code !== 0) proc.stderr.emit('data', Buffer.from('Error extracting frame\n'));
      proc.emit('close', code, null);
    });
    return proc;
  });
}

const ffmpegCalls = () => mockSpawn.mock.calls.filter((c) => c[0] === 'ffmpeg');
const seekOf = (args: string[]) => args[args.indexOf('-ss') + 1];

describe('extractThumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    written.clear();
  });

  it('extracts at 25%, 50%, 75% of the video', async () => {
    setup();
    await extractThumbnails('/input/video.mp4', 120_000, '/output');
    expect(ffmpegCalls().map((c) => seekOf(c[1]))).toEqual(['30.00', '60.00', '90.00']);
  });

  it('keeps the shots inside the video when the duration given is the longer container', async () => {
    setup({
      probe: {
        format: { duration: '40.0' },
        streams: [
          { index: 0, codec_type: 'video', width: 1280, height: 720, duration: '4.0' },
          { index: 1, codec_type: 'audio', duration: '40.0' },
        ],
      },
    });
    const paths = await extractThumbnails('/input/video.mp4', 40_000, '/output');
    expect(ffmpegCalls().map((c) => seekOf(c[1]))).toEqual(['1.00', '2.00', '3.00']);
    expect(paths).toHaveLength(3);
  });

  it('grabs from the probed video stream with the input whitelists and errors-only logging', async () => {
    setup();
    await extractThumbnails('/input/video.mp4', 100_000, '/output');
    const [command, args] = ffmpegCalls()[0];
    expect(command).toBe('ffmpeg');
    expect(args).toEqual(expect.arrayContaining(['-protocol_whitelist', 'file', '-v', 'error']));
    expect(args[args.indexOf('-map') + 1]).toBe('0:1');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(args[args.indexOf('-i') + 1]).toBe('/input/video.mp4');
  });

  it('tone-maps the thumbnails of an HDR source', async () => {
    setup({
      probe: {
        format: { duration: '10.0' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            width: 1920,
            height: 1080,
            duration: '10.0',
            color_transfer: 'arib-std-b67',
          },
        ],
      },
    });
    await extractThumbnails('/input/video.mp4', 10_000, '/output');
    const args = ffmpegCalls()[0][1] as string[];
    expect(args[args.indexOf('-vf') + 1]).toContain('zscale=tin=arib-std-b67');
  });

  it('returns the local file paths it wrote to', async () => {
    setup();
    const paths = await extractThumbnails('/input/video.mp4', 100_000, '/output/thumbs');
    expect(paths).toEqual([
      '/output/thumbs/thumb_25.jpg',
      '/output/thumbs/thumb_50.jpg',
      '/output/thumbs/thumb_75.jpg',
    ]);
  });

  it('skips a shot that fails, writes nothing or writes an empty file, and keeps the rest', async () => {
    setup({ codes: [234, 0, 0], sizes: [undefined, 0, 2048] });
    const paths = await extractThumbnails('/input/video.mp4', 60_000, '/output');
    expect(paths).toEqual(['/output/thumb_75.jpg']);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[0][0].err.message).toMatch(
      /Thumbnail extraction exited with code 234: Error extracting frame/,
    );
    expect(logger.warn.mock.calls[1][0].err.message).toMatch(/thumb_50\.jpg is empty/);
  });

  it('skips a shot ffmpeg exits 0 for without writing a file', async () => {
    setup({ sizes: [1000, undefined, 1000] });
    const paths = await extractThumbnails('/input/video.mp4', 60_000, '/output');
    expect(paths).toEqual(['/output/thumb_25.jpg', '/output/thumb_75.jpg']);
  });

  it('returns no thumbnails, without throwing, when the source cannot be probed', async () => {
    setup({ probeCode: 1 });
    await expect(extractThumbnails('/input/video.mp4', 60_000, '/output')).resolves.toEqual([]);
    expect(ffmpegCalls()).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('skips every shot when ffmpeg cannot be spawned', async () => {
    mockSpawn.mockImplementation((command: string) => {
      const proc = createMockProcess();
      process.nextTick(() => {
        if (command === 'ffprobe') {
          proc.stdout.emit('data', Buffer.from(JSON.stringify(PROBE)));
          proc.emit('close', 0, null);
        } else {
          proc.emit('error', new Error('ENOENT: ffmpeg not found'));
        }
      });
      return proc;
    });
    await expect(extractThumbnails('/input/video.mp4', 60_000, '/output')).resolves.toEqual([]);
    expect(logger.warn.mock.calls[0][0].err.message).toMatch(/spawn error: ENOENT/);
  });
});
