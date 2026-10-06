import { describe, it, expect } from 'vitest';
import {
  RENDITION_LADDER,
  KEYFRAME_INTERVAL_SECONDS,
  HLS_SEGMENT_SECONDS,
  selectRenditions,
  buildFilterComplex,
  buildVarStreamMap,
  buildTranscodeArgs,
  buildProbeArgs,
  planThumbnails,
  buildThumbnailArgs,
  type Rendition,
} from '../transcode/ffmpeg-args.js';

const names = (vs: readonly Rendition[]) => vs.map((v) => v.name);
const rung = (name: string) => RENDITION_LADDER.find((r) => r.name === name)!;

/** The value that follows `flag`, failing loudly when the flag is absent. */
function valueOf(args: string[], flag: string): string {
  const i = args.indexOf(flag);
  if (i === -1) throw new Error(`flag ${flag} not in args`);
  return args[i + 1];
}

function countOf(args: string[], token: string): number {
  return args.filter((a) => a === token).length;
}

describe('selectRenditions', () => {
  it.each([
    [2160, ['1080p', '720p', '540p', '360p']],
    [1080, ['1080p', '720p', '540p', '360p']],
    [1079, ['720p', '540p', '360p']],
    [720, ['720p', '540p', '360p']],
    [719, ['540p', '360p']],
    [540, ['540p', '360p']],
    [480, ['360p']],
    [360, ['360p']],
  ])('source height %i keeps %j (never upscales)', (height, expected) => {
    expect(names(selectRenditions(height))).toEqual(expected);
  });

  it('keeps only the smallest rung for a source below every rung', () => {
    expect(names(selectRenditions(240))).toEqual(['360p']);
    expect(names(selectRenditions(1))).toEqual(['360p']);
  });

  it('keeps the full ladder when the height is unknown', () => {
    expect(names(selectRenditions(0))).toEqual(['1080p', '720p', '540p', '360p']);
  });

  it('selects by height only, so a portrait source gets every rung its height allows', () => {
    // 1080x1920 portrait: 1920 tall, so all rungs (each is letterboxed into a
    // landscape box by the pad filter)
    expect(names(selectRenditions(1920))).toEqual(['1080p', '720p', '540p', '360p']);
    // 360x640 portrait phone clip
    expect(names(selectRenditions(640))).toEqual(['540p', '360p']);
  });

  it('selects by height only, so an ultra-wide source is not capped by its width', () => {
    // 2560x1080 (21:9)
    expect(names(selectRenditions(1080))).toEqual(['1080p', '720p', '540p', '360p']);
  });

  it('returns fresh arrays so callers cannot mutate the shared ladder', () => {
    const picked = selectRenditions(0);
    picked.pop();
    expect(RENDITION_LADDER).toHaveLength(4);
  });
});

describe('RENDITION_LADDER', () => {
  it('has the documented 16:9 boxes and bitrates, tallest first', () => {
    expect(RENDITION_LADDER).toEqual([
      {
        name: '1080p',
        width: 1920,
        height: 1080,
        videoBitrate: '6000k',
        maxRate: '6420k',
        bufSize: '9000k',
        audioBitrate: '192k',
      },
      {
        name: '720p',
        width: 1280,
        height: 720,
        videoBitrate: '3500k',
        maxRate: '3745k',
        bufSize: '5250k',
        audioBitrate: '128k',
      },
      {
        name: '540p',
        width: 960,
        height: 540,
        videoBitrate: '1800k',
        maxRate: '1926k',
        bufSize: '2700k',
        audioBitrate: '128k',
      },
      {
        name: '360p',
        width: 640,
        height: 360,
        videoBitrate: '800k',
        maxRate: '856k',
        bufSize: '1200k',
        audioBitrate: '96k',
      },
    ]);
  });

  it('caps every rung at about 7% over its target with a 1.5x buffer', () => {
    for (const r of RENDITION_LADDER) {
      const target = parseInt(r.videoBitrate, 10);
      expect(parseInt(r.maxRate, 10)).toBe(Math.round(target * 1.07));
      expect(parseInt(r.bufSize, 10)).toBe(target * 1.5);
      // even dimensions are required by libx264 with yuv420p
      expect(r.width % 2).toBe(0);
      expect(r.height % 2).toBe(0);
    }
  });
});

describe('buildFilterComplex', () => {
  it('splits once per rendition and scales then pads each copy into its box', () => {
    expect(buildFilterComplex([rung('720p'), rung('360p')])).toBe(
      '[0:v]split=2[v0][v1];' +
        '[v0]scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v0out];' +
        '[v1]scale=w=640:h=360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v1out]',
    );
  });

  it('handles a single rendition', () => {
    expect(buildFilterComplex([rung('360p')])).toBe(
      '[0:v]split=1[v0];' +
        '[v0]scale=w=640:h=360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v0out]',
    );
  });

  it('labels outputs in ladder order for the full ladder', () => {
    const fc = buildFilterComplex(RENDITION_LADDER);
    const parts = fc.split(';');
    expect(parts[0]).toBe('[0:v]split=4[v0][v1][v2][v3]');
    RENDITION_LADDER.forEach((r, i) => {
      expect(parts[i + 1]).toBe(
        `[v${i}]scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease,` +
          `pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2[v${i}out]`,
      );
    });
  });
});

describe('buildVarStreamMap', () => {
  it('pairs each video stream with its audio copy when audio exists', () => {
    expect(buildVarStreamMap([rung('720p'), rung('360p')], true)).toBe(
      'v:0,a:0,name:720p v:1,a:1,name:360p',
    );
  });

  it('leaves audio out when the source has none', () => {
    expect(buildVarStreamMap([rung('720p'), rung('360p')], false)).toBe(
      'v:0,name:720p v:1,name:360p',
    );
  });
});

describe('buildTranscodeArgs', () => {
  it('produces the exact argument list for two renditions with audio', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in/source.mov',
      outputDir: '/out/asset-1',
      variants: [rung('720p'), rung('360p')],
      hasAudio: true,
    });
    expect(args).toEqual([
      '-hide_banner',
      '-y',
      '-i',
      '/in/source.mov',
      '-filter_complex',
      buildFilterComplex([rung('720p'), rung('360p')]),
      '-map',
      '[v0out]',
      '-map',
      '0:a',
      '-c:v:0',
      'libx264',
      '-b:v:0',
      '3500k',
      '-maxrate:v:0',
      '3745k',
      '-bufsize:v:0',
      '5250k',
      '-map',
      '[v1out]',
      '-map',
      '0:a',
      '-c:v:1',
      'libx264',
      '-b:v:1',
      '800k',
      '-maxrate:v:1',
      '856k',
      '-bufsize:v:1',
      '1200k',
      '-b:a:0',
      '128k',
      '-b:a:1',
      '96k',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-profile:v',
      'main',
      '-preset',
      'ultrafast',
      '-threads',
      '0',
      '-force_key_frames',
      'expr:gte(t,n_forced*2)',
      '-sc_threshold',
      '0',
      '-f',
      'hls',
      '-hls_time',
      '6',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_type',
      'fmp4',
      '-hls_flags',
      'independent_segments+single_file',
      '-master_pl_name',
      'master.m3u8',
      '-hls_segment_filename',
      '/out/asset-1/%v/data.m4s',
      '-var_stream_map',
      'v:0,a:0,name:720p v:1,a:1,name:360p',
      '/out/asset-1/%v/playlist.m3u8',
    ]);
  });

  it('sets codec, bitrate, maxrate and bufsize per output stream for the full ladder', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      variants: RENDITION_LADDER,
      hasAudio: true,
    });
    RENDITION_LADDER.forEach((r, i) => {
      expect(valueOf(args, `-c:v:${i}`)).toBe('libx264');
      expect(valueOf(args, `-b:v:${i}`)).toBe(r.videoBitrate);
      expect(valueOf(args, `-maxrate:v:${i}`)).toBe(r.maxRate);
      expect(valueOf(args, `-bufsize:v:${i}`)).toBe(r.bufSize);
      expect(valueOf(args, `-b:a:${i}`)).toBe(r.audioBitrate);
    });
    expect(countOf(args, '-map')).toBe(8);
    expect(countOf(args, '0:a')).toBe(4);
    expect(args.indexOf('-c:v:4')).toBe(-1);
  });

  it('maps each video output right before its own codec options', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      variants: RENDITION_LADDER,
      hasAudio: false,
    });
    RENDITION_LADDER.forEach((_, i) => {
      const map = args.indexOf(`[v${i}out]`);
      expect(args[map - 1]).toBe('-map');
      expect(args[map + 1]).toBe(`-c:v:${i}`);
    });
  });

  it('omits every audio option when the source has no audio', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      variants: [rung('540p'), rung('360p')],
      hasAudio: false,
    });
    expect(args).not.toContain('0:a');
    expect(args).not.toContain('-c:a');
    expect(args).not.toContain('-ac');
    expect(args).not.toContain('-ar');
    expect(args.some((a) => a.startsWith('-b:a'))).toBe(false);
    expect(countOf(args, '-map')).toBe(2);
    expect(valueOf(args, '-var_stream_map')).toBe('v:0,name:540p v:1,name:360p');
  });

  it('encodes stereo 48 kHz AAC when the source has audio', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      variants: [rung('360p')],
      hasAudio: true,
    });
    expect(valueOf(args, '-c:a')).toBe('aac');
    expect(valueOf(args, '-ac')).toBe('2');
    expect(valueOf(args, '-ar')).toBe('48000');
    expect(valueOf(args, '-var_stream_map')).toBe('v:0,a:0,name:360p');
  });

  it('forces a keyframe every 2s with scene-cut keyframes off, so segments cut cleanly', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      variants: [rung('360p')],
      hasAudio: false,
    });
    expect(valueOf(args, '-force_key_frames')).toBe(
      `expr:gte(t,n_forced*${KEYFRAME_INTERVAL_SECONDS})`,
    );
    expect(valueOf(args, '-sc_threshold')).toBe('0');
    expect(valueOf(args, '-profile:v')).toBe('main');
    expect(valueOf(args, '-preset')).toBe('ultrafast');
    // a segment can only end on a keyframe, so the target must be a multiple
    expect(HLS_SEGMENT_SECONDS % KEYFRAME_INTERVAL_SECONDS).toBe(0);
    expect(valueOf(args, '-hls_time')).toBe(String(HLS_SEGMENT_SECONDS));
  });

  it('writes vod HLS with single_file fMP4 output', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      variants: [rung('360p')],
      hasAudio: false,
    });
    expect(valueOf(args, '-f')).toBe('hls');
    expect(valueOf(args, '-hls_playlist_type')).toBe('vod');
    expect(valueOf(args, '-hls_segment_type')).toBe('fmp4');
    expect(valueOf(args, '-hls_flags').split('+').sort()).toEqual([
      'independent_segments',
      'single_file',
    ]);
    expect(valueOf(args, '-master_pl_name')).toBe('master.m3u8');
  });

  it('places the input first and the playlist template last, under the output dir', () => {
    const args = buildTranscodeArgs({
      inputPath: '/uploads/abc/source file.mp4',
      outputDir: '/var/transcode/asset-9',
      variants: [rung('360p')],
      hasAudio: false,
    });
    expect(args.slice(0, 4)).toEqual(['-hide_banner', '-y', '-i', '/uploads/abc/source file.mp4']);
    expect(valueOf(args, '-hls_segment_filename')).toBe('/var/transcode/asset-9/%v/data.m4s');
    expect(args[args.length - 1]).toBe('/var/transcode/asset-9/%v/playlist.m3u8');
  });

  it('normalizes a trailing slash in the output dir', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out/',
      variants: [rung('360p')],
      hasAudio: false,
    });
    expect(args[args.length - 1]).toBe('/out/%v/playlist.m3u8');
  });

  it('gives every option flag a value', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      variants: RENDITION_LADDER,
      hasAudio: true,
    });
    // everything after -hide_banner and -y is "-flag value" pairs plus the
    // trailing output path
    const pairs = args.slice(2, -1);
    expect(pairs.length % 2).toBe(0);
    for (let i = 0; i < pairs.length; i += 2) {
      expect(pairs[i].startsWith('-')).toBe(true);
      expect(pairs[i + 1]).toBeTruthy();
    }
  });
});

describe('buildProbeArgs', () => {
  it('asks ffprobe for quiet JSON with format and streams', () => {
    expect(buildProbeArgs('/in/a.mp4')).toEqual([
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '/in/a.mp4',
    ]);
  });
});

describe('planThumbnails', () => {
  it('takes shots at 25%, 50% and 75% of the duration', () => {
    expect(planThumbnails(120_000, '/out/a')).toEqual([
      { timeSeconds: 30, outputPath: '/out/a/thumb_25.jpg' },
      { timeSeconds: 60, outputPath: '/out/a/thumb_50.jpg' },
      { timeSeconds: 90, outputPath: '/out/a/thumb_75.jpg' },
    ]);
  });

  it('plans shots at 0s for a zero-length source', () => {
    expect(planThumbnails(0, '/o').map((s) => s.timeSeconds)).toEqual([0, 0, 0]);
  });
});

describe('buildThumbnailArgs', () => {
  it('seeks before the input, grabs one frame and letterboxes it to 640x360', () => {
    expect(buildThumbnailArgs('/in.mp4', 12.345, '/out/thumb_25.jpg')).toEqual([
      '-y',
      '-ss',
      '12.35',
      '-i',
      '/in.mp4',
      '-vframes',
      '1',
      '-vf',
      'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2',
      '-q:v',
      '2',
      '/out/thumb_25.jpg',
    ]);
  });

  it('formats the seek time with two decimals', () => {
    expect(valueOf(buildThumbnailArgs('/i', 3, '/o.jpg'), '-ss')).toBe('3.00');
    expect(valueOf(buildThumbnailArgs('/i', 0.004, '/o.jpg'), '-ss')).toBe('0.00');
  });
});
