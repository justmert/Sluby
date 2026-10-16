import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const playlists = new Map<string, string>();
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(async (file: string) => {
    const content = playlists.get(file);
    if (content === undefined) throw new Error(`ENOENT: no such file, open '${file}'`);
    return content;
  }),
}));

type MockProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockProcess(): MockProcess {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  // a killed process closes with no code and the signal, like a real one
  proc.kill.mockImplementation((signal: string) => {
    process.nextTick(() => proc.emit('close', null, signal));
    return true;
  });
  return proc;
}

const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import {
  BoundedOutput,
  TRANSCODE_CONCURRENCY,
  encoderThreads,
  parseProbeOutput,
  runFfmpegTool,
  summarizeFfmpegErrors,
  transcode,
  transcodeTimeoutMs,
} from '../transcode/ffmpeg-runner.js';
import { mkdir } from 'node:fs/promises';
import { UnreadableSourceError } from '../transcode/source-errors.js';

const PLAYLIST =
  '#EXTM3U\n#EXT-X-MAP:URI="data.m4s",BYTERANGE="10@0"\n' +
  '#EXTINF:6.0,\n#EXT-X-BYTERANGE:5@10\ndata.m4s\n' +
  '#EXTINF:6.0,\n#EXT-X-BYTERANGE:5@15\ndata.m4s\n#EXT-X-ENDLIST\n';

const VIDEO_1080 = {
  index: 0,
  codec_type: 'video',
  width: 1920,
  height: 1080,
  duration: '60.000000',
};

function probeJson(overrides: object = {}) {
  return {
    format: { duration: '60.0', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    streams: [VIDEO_1080],
    ...overrides,
  };
}

/** ffprobe answers with `probe`; ffmpeg prints `stdout` chunks, then exits. */
function setupTranscode(opts?: {
  probe?: object;
  ffmpegStdout?: string[];
  ffmpegStderr?: string;
  ffmpegExitCode?: number;
  writePlaylists?: boolean;
}) {
  mockSpawn.mockImplementation((command: string) => {
    const proc = createMockProcess();
    if (command === 'ffprobe') {
      process.nextTick(() => {
        proc.stdout.emit('data', Buffer.from(JSON.stringify(opts?.probe ?? probeJson())));
        process.nextTick(() => proc.emit('close', 0, null));
      });
      return proc;
    }
    const args = mockSpawn.mock.calls.at(-1)![1] as string[];
    process.nextTick(async () => {
      for (const chunk of opts?.ffmpegStdout ?? []) {
        proc.stdout.emit('data', Buffer.from(chunk));
        await new Promise((r) => process.nextTick(r));
      }
      if (opts?.ffmpegStderr) proc.stderr.emit('data', Buffer.from(opts.ffmpegStderr));
      const code = opts?.ffmpegExitCode ?? 0;
      if (code === 0 && opts?.writePlaylists !== false) {
        const out = args[args.length - 1];
        const names = (args[args.indexOf('-var_stream_map') + 1] ?? '')
          .split(' ')
          .map((e) => e.split('name:')[1]);
        for (const name of names) playlists.set(out.replace('%v', name), PLAYLIST);
      }
      proc.emit('close', code, null);
    });
    return proc;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  playlists.clear();
});

describe('parseProbeOutput', () => {
  const parse = (o: object) => parseProbeOutput(JSON.stringify(o));

  it('reads a plain landscape source', () => {
    expect(parse(probeJson())).toMatchObject({
      videoStreamIndex: 0,
      audioStreamIndex: null,
      displayWidth: 1920,
      displayHeight: 1080,
      width: 1920,
      height: 1080,
      durationMs: 60000,
      hdr: null,
      trimSeconds: null,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    });
  });

  it('swaps width and height for a stream rotated by 90 or 270 degrees', () => {
    for (const rotation of [90, -90, 270]) {
      const p = parse(
        probeJson({
          streams: [
            { ...VIDEO_1080, side_data_list: [{ side_data_type: 'Display Matrix', rotation }] },
          ],
        }),
      );
      expect([p.width, p.height, p.displayWidth, p.displayHeight]).toEqual([
        1080, 1920, 1080, 1920,
      ]);
    }
    const upsideDown = parse(
      probeJson({ streams: [{ ...VIDEO_1080, side_data_list: [{ rotation: 180 }] }] }),
    );
    expect([upsideDown.width, upsideDown.height]).toEqual([1920, 1080]);
    // older ffprobe builds report a rotate tag instead
    const tagged = parse(probeJson({ streams: [{ ...VIDEO_1080, tags: { rotate: '90' } }] }));
    expect(tagged.width).toBe(1080);
  });

  it('applies a non-square sample aspect ratio to the shown size only', () => {
    const p = parse(
      probeJson({
        streams: [
          { index: 0, codec_type: 'video', width: 720, height: 576, sample_aspect_ratio: '16:15' },
        ],
      }),
    );
    expect([p.width, p.height]).toEqual([720, 576]);
    expect([p.displayWidth, p.displayHeight]).toEqual([768, 576]);
    const unknown = parse(
      probeJson({
        streams: [
          { index: 0, codec_type: 'video', width: 720, height: 576, sample_aspect_ratio: '0:1' },
        ],
      }),
    );
    expect(unknown.displayWidth).toBe(720);
  });

  it('takes the duration from the video stream, not the longer container', () => {
    const p = parse({
      format: { duration: '40.000000', start_time: '0.000000' },
      streams: [
        { ...VIDEO_1080, duration: '4.000000', start_time: '0.000000' },
        { index: 1, codec_type: 'audio', duration: '40.000000' },
      ],
    });
    expect(p.durationMs).toBe(4000);
    expect(p.trimSeconds).toBe(4);
  });

  it('does not trim when audio is only a little longer than the video', () => {
    const p = parse({
      format: { duration: '4.021000' },
      streams: [
        { ...VIDEO_1080, duration: '4.000000' },
        { index: 1, codec_type: 'audio', duration: '4.021000' },
      ],
    });
    expect(p.trimSeconds).toBeNull();
  });

  it('does not trim a source without audio', () => {
    const p = parse({
      format: { duration: '40.0' },
      streams: [{ ...VIDEO_1080, duration: '4.0' }],
    });
    expect(p.trimSeconds).toBeNull();
    expect(p.durationMs).toBe(4000);
  });

  it('counts a late video start in the trim point', () => {
    const p = parse({
      format: { duration: '40.0', start_time: '0.000000' },
      streams: [
        { ...VIDEO_1080, duration: '4.0', start_time: '0.500000' },
        { index: 1, codec_type: 'audio', duration: '40.0', start_time: '0.000000' },
      ],
    });
    expect(p.trimSeconds).toBe(4.5);
  });

  it('reads the matroska DURATION tag, then falls back to the container', () => {
    const mkv = parse({
      format: { duration: '40.0' },
      streams: [
        {
          index: 0,
          codec_type: 'video',
          width: 640,
          height: 360,
          tags: { DURATION: '00:00:04.500000000' },
        },
        { index: 1, codec_type: 'audio', tags: { DURATION: '00:00:40.000000000' } },
      ],
    });
    expect(mkv.durationMs).toBe(4500);
    expect(mkv.trimSeconds).toBe(4.5);
    const bare = parse({
      format: { duration: '12.5' },
      streams: [{ index: 0, codec_type: 'video', width: 640, height: 360 }],
    });
    expect(bare.durationMs).toBe(12500);
    expect(bare.trimSeconds).toBeNull();
    const none = parse({
      format: {},
      streams: [{ index: 0, codec_type: 'video', width: 640, height: 360 }],
    });
    expect(none.durationMs).toBe(0);
  });

  it('keeps one audio stream: the default one, else the first', () => {
    const streams = [
      VIDEO_1080,
      { index: 1, codec_type: 'audio', disposition: { default: 0 } },
      { index: 2, codec_type: 'audio', disposition: { default: 1 } },
    ];
    expect(parse(probeJson({ streams })).audioStreamIndex).toBe(2);
    const noDefault = streams.map((s) => ({ ...s, disposition: { default: 0 } }));
    expect(parse(probeJson({ streams: noDefault })).audioStreamIndex).toBe(1);
  });

  it('skips cover art and uses the real video stream index', () => {
    const p = parse(
      probeJson({
        streams: [
          { index: 0, codec_type: 'audio' },
          {
            index: 1,
            codec_type: 'video',
            width: 600,
            height: 600,
            disposition: { attached_pic: 1 },
          },
          { ...VIDEO_1080, index: 2 },
        ],
      }),
    );
    expect(p.videoStreamIndex).toBe(2);
    expect(p.audioStreamIndex).toBe(0);
    expect(p.width).toBe(1920);
  });

  it('marks PQ and HLG sources as HDR with their colour, assuming BT.2020 when untagged', () => {
    const pq = parse(
      probeJson({
        streams: [
          {
            ...VIDEO_1080,
            color_transfer: 'smpte2084',
            color_primaries: 'bt2020',
            color_space: 'bt2020nc',
            color_range: 'tv',
          },
        ],
      }),
    );
    expect(pq.hdr).toEqual({
      transfer: 'smpte2084',
      primaries: 'bt2020',
      matrix: 'bt2020nc',
      range: 'tv',
    });
    const hlg = parse(
      probeJson({
        streams: [{ ...VIDEO_1080, color_transfer: 'arib-std-b67', color_range: 'pc' }],
      }),
    );
    expect(hlg.hdr).toEqual({
      transfer: 'arib-std-b67',
      primaries: 'bt2020',
      matrix: 'bt2020nc',
      range: 'pc',
    });
    for (const transfer of ['bt709', 'smpte170m', undefined]) {
      expect(
        parse(probeJson({ streams: [{ ...VIDEO_1080, color_transfer: transfer }] })).hdr,
      ).toBeNull();
    }
  });

  it('rejects input with no video stream, no frame size or broken JSON', () => {
    expect(() => parse({ format: {}, streams: [{ index: 0, codec_type: 'audio' }] })).toThrow(
      'No video stream found',
    );
    expect(() =>
      parse({ streams: [{ index: 0, codec_type: 'video', width: 0, height: 0 }] }),
    ).toThrow('no frame size');
    expect(() => parseProbeOutput('{not json')).toThrow('Failed to parse ffprobe output');
  });
});

describe('summarizeFfmpegErrors', () => {
  it('keeps the first distinct lines and drops context addresses and repeats', () => {
    const stderr = [
      "[libx264 @ 0x6000039f0000] main profile doesn't support a bit depth of 10",
      '[vost#0:0/libx264 @ 0x600003af8000] Error while opening encoder - maybe incorrect parameters',
      '    Last message repeated 1 times',
      "[libx264 @ 0x6000039f0000] main profile doesn't support a bit depth of 10",
      '',
      'Conversion failed!',
    ].join('\n');
    expect(summarizeFfmpegErrors(stderr)).toBe(
      "[libx264] main profile doesn't support a bit depth of 10; " +
        '[vost#0:0/libx264] Error while opening encoder - maybe incorrect parameters; ' +
        'Conversion failed!',
    );
  });

  it('bounds the number of lines and the length', () => {
    const many = Array.from({ length: 20 }, (_, i) => `error ${i}`).join('\n');
    expect(summarizeFfmpegErrors(many)).toBe('error 0; error 1; error 2; error 3; error 4');
    const long = summarizeFfmpegErrors('x'.repeat(5000));
    expect(long).toHaveLength(600);
    expect(long.endsWith('...')).toBe(true);
  });
});

describe('BoundedOutput', () => {
  it('keeps the start and the end within its limit', () => {
    const out = new BoundedOutput(10);
    out.push('0123456789');
    out.push('abcdefghij');
    out.push('KLMNOPQRST');
    expect(out.start()).toBe('0123456789');
    expect(out.toString()).toBe('0123456789\n[10 characters dropped]\nKLMNOPQRST');
  });

  it('returns everything when it fits', () => {
    const out = new BoundedOutput(10);
    out.push('abc');
    out.push('defghijkl');
    expect(out.toString()).toBe('abcdefghijkl');
  });

  it('stays bounded over a long stream of errors', () => {
    const out = new BoundedOutput(1024);
    for (let i = 0; i < 100_000; i++) out.push(`[h264] error while decoding MB ${i}\n`);
    expect(out.toString().length).toBeLessThan(2 * 1024 + 100);
    expect(out.start()).toMatch(/^\[h264\] error while decoding MB 0\n/);
  });
});

describe('encoderThreads', () => {
  it('splits the cores between the concurrent transcodes', () => {
    expect(TRANSCODE_CONCURRENCY).toBe(2);
    expect(encoderThreads(12)).toBe(6);
    expect(encoderThreads(3)).toBe(1);
    expect(encoderThreads(1)).toBe(1);
  });
});

describe('transcodeTimeoutMs', () => {
  it('scales with the source length and has a flat limit for an unknown one', () => {
    expect(transcodeTimeoutMs(10_000)).toBe(30 * 60_000 + 600_000);
    expect(transcodeTimeoutMs(0)).toBe(12 * 60 * 60_000);
    expect(transcodeTimeoutMs(NaN)).toBe(12 * 60 * 60_000);
  });
});

describe('runFfmpegTool', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with stdout when asked to capture it', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => {
        proc.stdout.emit('data', Buffer.from('{"a":'));
        proc.stdout.emit('data', Buffer.from('1}'));
        proc.emit('close', 0, null);
      });
      return proc;
    });
    await expect(
      runFfmpegTool('ffprobe', ['x'], { label: 'ffprobe', timeoutMs: 1000, captureStdout: 100 }),
    ).resolves.toBe('{"a":1}');
    expect(mockSpawn.mock.calls[0][2]).toEqual({ stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('puts the cause from the start of stderr in the error', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => {
        proc.stderr.emit('data', Buffer.from('[mov,mp4 @ 0x1] moov atom not found\n'));
        proc.stderr.emit(
          'data',
          Buffer.from('/in.mp4: Invalid data found when processing input\n'),
        );
        proc.emit('close', 1, null);
      });
      return proc;
    });
    await expect(
      runFfmpegTool('ffprobe', [], { label: 'ffprobe', timeoutMs: 1000 }),
    ).rejects.toThrow(
      'ffprobe exited with code 1: [mov,mp4] moov atom not found; /in.mp4: Invalid data found when processing input',
    );
  });

  it('says so when a failed run printed nothing', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => proc.emit('close', 1, null));
      return proc;
    });
    await expect(
      runFfmpegTool('ffprobe', [], { label: 'ffprobe', timeoutMs: 1000 }),
    ).rejects.toThrow('ffprobe exited with code 1: no error output');
  });

  it('kills the process with SIGKILL when the time limit passes', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const run = runFfmpegTool('ffmpeg', [], { label: 'FFmpeg', timeoutMs: 5000 });
    const assertion = expect(run).rejects.toThrow('FFmpeg timed out after 5s and was killed');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills a run that stops making progress, but not one that keeps going', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const run = runFfmpegTool('ffmpeg', [], {
      label: 'FFmpeg',
      timeoutMs: 60_000,
      stallTimeoutMs: 1000,
      onStdout: (chunk, progressed) => {
        if (chunk === 'tick') progressed();
      },
    });
    const assertion = expect(run).rejects.toThrow('FFmpeg made no progress for 1s and was killed');
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(900);
      proc.stdout.emit('data', Buffer.from('tick'));
    }
    expect(proc.kill).not.toHaveBeenCalled();
    // output without progress does not keep it alive
    proc.stdout.emit('data', Buffer.from('noise'));
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills ffprobe when it prints more than it may', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const run = runFfmpegTool('ffprobe', [], {
      label: 'ffprobe',
      timeoutMs: 1000,
      captureStdout: 4,
    });
    proc.stdout.emit('data', Buffer.from('12345'));
    await expect(run).rejects.toThrow('ffprobe printed more than 4 characters');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('reports a spawn failure once', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => {
        proc.emit('error', new Error('ENOENT: ffmpeg not found'));
        proc.emit('close', -2, null);
      });
      return proc;
    });
    await expect(runFfmpegTool('ffmpeg', [], { label: 'FFmpeg', timeoutMs: 1000 })).rejects.toThrow(
      'FFmpeg spawn error: ENOENT: ffmpeg not found',
    );
  });
});

describe('transcode', () => {
  it('creates the output directory and one directory per rendition', async () => {
    setupTranscode();
    await transcode('/input/video.mp4', '/output/dir');
    for (const dir of [
      '/output/dir',
      ...['1080p', '720p', '540p', '360p'].map((n) => `/output/dir/${n}`),
    ]) {
      expect(mkdir).toHaveBeenCalledWith(dir, { recursive: true });
    }
  });

  it('probes first, then runs ffmpeg with the probed source', async () => {
    setupTranscode({
      probe: probeJson({
        streams: [
          { ...VIDEO_1080, side_data_list: [{ rotation: -90 }] },
          { index: 1, codec_type: 'audio' },
          { index: 2, codec_type: 'audio', disposition: { default: 1 } },
        ],
      }),
    });
    await transcode('/input/video.mp4', '/output/dir');
    expect(mockSpawn.mock.calls[0][0]).toBe('ffprobe');
    expect(mockSpawn.mock.calls[0][1]).toContain('/input/video.mp4');
    expect(mockSpawn.mock.calls[1][0]).toBe('ffmpeg');
    const args = mockSpawn.mock.calls[1][1] as string[];
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('[v0]scale=1080:1920,');
    expect(args.filter((a) => a === '0:2')).toHaveLength(4);
    expect(args[args.indexOf('-threads') + 1]).toBe(String(encoderThreads()));
  });

  it('returns the shown resolution, the video duration and the segments FFmpeg wrote', async () => {
    setupTranscode({
      probe: {
        format: { duration: '40.0' },
        streams: [
          { ...VIDEO_1080, duration: '4.0', side_data_list: [{ rotation: 90 }] },
          { index: 1, codec_type: 'audio', duration: '40.0' },
        ],
      },
    });
    const result = await transcode('/input/video.mp4', '/output/dir');
    expect(result).toEqual({
      masterPlaylistPath: '/output/dir/master.m3u8',
      variantDirs: ['1080p', '720p', '540p', '360p'].map((n) => `/output/dir/${n}`),
      // two segments in each of the four playlists
      segmentCount: 8,
      durationMs: 4000,
      resolution: '1080x1920',
    });
    const args = mockSpawn.mock.calls[1][1] as string[];
    expect(args[args.indexOf('-t') + 1]).toBe('4.000');
  });

  it('makes the taller rungs when asked to', async () => {
    setupTranscode({
      probe: probeJson({ streams: [{ ...VIDEO_1080, width: 3840, height: 2160 }] }),
    });
    const result = await transcode('/in.mp4', '/out', { maxRendition: '2160p' });
    expect(result.variantDirs.map((d) => d.split('/').pop())).toEqual([
      '2160p',
      '1440p',
      '1080p',
      '720p',
      '540p',
      '360p',
    ]);
  });

  it('fails when FFmpeg exits 0 without writing a variant playlist', async () => {
    setupTranscode({ writePlaylists: false });
    await expect(transcode('/input/video.mp4', '/output/dir')).rejects.toThrow(
      /FFmpeg finished without writing \/output\/dir\/1080p\/playlist\.m3u8/,
    );
  });

  it('rejects with the cause when ffprobe fails', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => {
        proc.stderr.emit(
          'data',
          Buffer.from('/bad/video.mp4: Invalid data found when processing input\n'),
        );
        proc.emit('close', 1, null);
      });
      return proc;
    });
    const failure = transcode('/bad/video.mp4', '/output');
    await expect(failure).rejects.toThrow(
      'ffprobe exited with code 1: /bad/video.mp4: Invalid data found when processing input',
    );
    // a file that is not a video: retrying cannot help
    await expect(failure).rejects.toBeInstanceOf(UnreadableSourceError);
  });

  it('keeps a probe that timed out or crashed an ordinary, retried failure', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      process.nextTick(() => proc.emit('close', null, 'SIGSEGV'));
      return proc;
    });
    const failure = transcode('/in.mp4', '/output');
    await expect(failure).rejects.toThrow('ffprobe was killed by SIGSEGV');
    await expect(failure).rejects.not.toBeInstanceOf(UnreadableSourceError);
  });

  it('rejects with the encoder error when ffmpeg fails', async () => {
    setupTranscode({
      ffmpegExitCode: 234,
      ffmpegStderr: "[libx264 @ 0x1] main profile doesn't support 4:2:2\nConversion failed!\n",
    });
    await expect(transcode('/input/video.mp4', '/output')).rejects.toThrow(
      "FFmpeg exited with code 234: [libx264] main profile doesn't support 4:2:2; Conversion failed!",
    );
  });

  it('rejects when ffprobe finds no video stream', async () => {
    setupTranscode({
      probe: { format: { duration: '60.0' }, streams: [{ index: 0, codec_type: 'audio' }] },
    });
    const failure = transcode('/audio-only.mp4', '/output');
    await expect(failure).rejects.toThrow('No video stream found');
    await expect(failure).rejects.toBeInstanceOf(UnreadableSourceError);
  });

  it('reports progress from the -progress lines on stdout, split across chunks', async () => {
    const progressValues: number[] = [];
    setupTranscode({
      ffmpegStdout: [
        'frame=1\nout_time_us=N/A\nprogress=continue\n',
        'out_time_us=300',
        '00000\nprogress=continue\nout_time_us=30000000\n',
        'out_time_us=60000000\nprogress=end\n',
      ],
    });
    await transcode('/input/video.mp4', '/output', {
      onProgress: (percent) => {
        progressValues.push(percent);
      },
    });
    // 30s of 60s, the repeated 30s line is skipped, then 60s
    expect(progressValues).toEqual([50, 100]);
  });

  it('keeps going when the progress callback rejects', async () => {
    setupTranscode({ ffmpegStdout: ['out_time_us=1000000\n'] });
    await expect(
      transcode('/input/video.mp4', '/output', {
        onProgress: () => Promise.reject(new Error('db down')) as unknown as void,
      }),
    ).resolves.toMatchObject({ segmentCount: 8 });
  });
});
