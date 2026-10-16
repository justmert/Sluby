import { describe, it, expect } from 'vitest';
import {
  ALLOWED_DEMUXERS,
  DEFAULT_MAX_RENDITION,
  RENDITION_LADDER,
  RENDITION_NAMES,
  KEYFRAME_INTERVAL_SECONDS,
  HLS_SEGMENT_SECONDS,
  INPUT_OPTIONS,
  selectRenditions,
  buildFilterComplex,
  buildSourceFilter,
  buildToneMapFilter,
  buildVarStreamMap,
  buildTranscodeArgs,
  buildProbeArgs,
  planThumbnails,
  buildThumbnailArgs,
  type Rendition,
  type SourceVideo,
} from '../transcode/ffmpeg-args.js';

const names = (vs: readonly Rendition[]) => vs.map((v) => v.name);
const sizes = (vs: readonly Rendition[]) => vs.map((v) => `${v.width}x${v.height}`);
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

const SDR: SourceVideo = {
  videoStreamIndex: 0,
  audioStreamIndex: 1,
  displayWidth: 1920,
  displayHeight: 1080,
  hdr: null,
  trimSeconds: null,
};

const PQ = {
  transfer: 'smpte2084',
  primaries: 'bt2020',
  matrix: 'bt2020nc',
  range: 'tv',
} as const;

const DEINTERLACE = 'bwdif=mode=send_frame:deint=interlaced';

describe('selectRenditions', () => {
  it.each([
    [3840, 2160, ['1080p', '720p', '540p', '360p']],
    [1920, 1080, ['1080p', '720p', '540p', '360p']],
    [1920, 1079, ['720p', '540p', '360p']],
    [1280, 720, ['720p', '540p', '360p']],
    [1278, 719, ['540p', '360p']],
    [960, 540, ['540p', '360p']],
    [854, 480, ['360p']],
    [640, 360, ['360p']],
  ])('a %ix%i source keeps %j by default (never upscales)', (w, h, expected) => {
    expect(names(selectRenditions(w, h))).toEqual(expected);
  });

  it('keeps only the smallest rung for a source below every rung', () => {
    expect(selectRenditions(320, 240)).toEqual([{ ...rung('360p'), width: 480, height: 360 }]);
    expect(names(selectRenditions(2, 2))).toEqual(['360p']);
  });

  it('refuses a source without a size', () => {
    expect(() => selectRenditions(0, 1080)).toThrow(/0x1080/);
    expect(() => selectRenditions(1920, NaN)).toThrow();
  });

  it('chooses rungs by the short side and keeps a portrait source portrait', () => {
    const portrait = selectRenditions(1080, 1920);
    expect(names(portrait)).toEqual(['1080p', '720p', '540p', '360p']);
    expect(sizes(portrait)).toEqual(['1080x1920', '720x1280', '540x960', '360x640']);
    // a 360x640 phone clip used to get a 540p rung by its height
    expect(sizes(selectRenditions(360, 640))).toEqual(['360x640']);
  });

  it('keeps the aspect ratio of non 16:9 sources with even sizes', () => {
    expect(sizes(selectRenditions(2560, 1080))).toEqual([
      '2560x1080',
      '1706x720',
      '1280x540',
      '854x360',
    ]);
    expect(sizes(selectRenditions(1440, 1080))).toEqual([
      '1440x1080',
      '960x720',
      '720x540',
      '480x360',
    ]);
    expect(sizes(selectRenditions(1080, 1080))).toEqual([
      '1080x1080',
      '720x720',
      '540x540',
      '360x360',
    ]);
    for (const v of selectRenditions(1001, 1777)) {
      expect(v.width % 2).toBe(0);
      expect(v.height % 2).toBe(0);
    }
  });

  it('keeps the bitrates of each rung', () => {
    for (const v of selectRenditions(1080, 1920)) {
      const r = rung(v.name);
      expect([v.videoBitrate, v.maxRate, v.bufSize, v.audioBitrate]).toEqual([
        r.videoBitrate,
        r.maxRate,
        r.bufSize,
        r.audioBitrate,
      ]);
    }
  });

  it('adds 1440p and 2160p only when the cap allows them and the source is that tall', () => {
    expect(names(selectRenditions(3840, 2160, '2160p'))).toEqual([
      '2160p',
      '1440p',
      '1080p',
      '720p',
      '540p',
      '360p',
    ]);
    expect(sizes(selectRenditions(3840, 2160, '2160p')).slice(0, 2)).toEqual([
      '3840x2160',
      '2560x1440',
    ]);
    expect(names(selectRenditions(3840, 2160, '1440p'))[0]).toBe('1440p');
    expect(names(selectRenditions(2560, 1440, '2160p'))[0]).toBe('1440p');
    expect(names(selectRenditions(1920, 1080, '2160p'))[0]).toBe('1080p');
    expect(sizes(selectRenditions(2160, 3840, '2160p'))[0]).toBe('2160x3840');
  });

  it('can cap the ladder below 1080p', () => {
    expect(names(selectRenditions(1920, 1080, '720p'))).toEqual(['720p', '540p', '360p']);
    expect(names(selectRenditions(1920, 1080, '360p'))).toEqual(['360p']);
  });

  it('defaults to a 1080p cap, the ladder before 1440p and 2160p existed', () => {
    expect(DEFAULT_MAX_RENDITION).toBe('1080p');
    expect(selectRenditions(3840, 2160)).toEqual(selectRenditions(3840, 2160, '1080p'));
  });

  it('returns fresh objects so callers cannot mutate the shared ladder', () => {
    const picked = selectRenditions(1920, 1080);
    picked[0].width = 1;
    picked.pop();
    expect(RENDITION_LADDER).toHaveLength(6);
    expect(rung('1080p').width).toBe(1920);
  });
});

describe('RENDITION_LADDER', () => {
  it('has the documented 16:9 sizes and bitrates, tallest first', () => {
    expect(RENDITION_LADDER).toEqual([
      {
        name: '2160p',
        width: 3840,
        height: 2160,
        videoBitrate: '15000k',
        maxRate: '16050k',
        bufSize: '22500k',
        audioBitrate: '192k',
      },
      {
        name: '1440p',
        width: 2560,
        height: 1440,
        videoBitrate: '9000k',
        maxRate: '9630k',
        bufSize: '13500k',
        audioBitrate: '192k',
      },
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
    expect(RENDITION_LADDER.map((r) => r.name)).toEqual([...RENDITION_NAMES]);
  });

  it('caps every rung at about 7% over its target with a 1.5x buffer', () => {
    for (const r of RENDITION_LADDER) {
      const target = parseInt(r.videoBitrate, 10);
      expect(parseInt(r.maxRate, 10)).toBe(Math.round(target * 1.07));
      expect(parseInt(r.bufSize, 10)).toBe(target * 1.5);
      expect(r.width % 2).toBe(0);
      expect(r.height % 2).toBe(0);
    }
  });
});

describe('buildToneMapFilter', () => {
  it('linearises the stated HDR colour, tone-maps to BT.709 and leaves 8-bit 4:2:0', () => {
    expect(buildToneMapFilter(PQ)).toBe(
      'zscale=tin=smpte2084:min=bt2020nc:pin=bt2020:rin=tv:t=linear:npl=203:p=bt2020,' +
        'format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0,' +
        'zscale=t=bt709:m=bt709:r=tv,format=yuv420p',
    );
  });

  it('uses the HLG transfer and full range when the source says so', () => {
    const f = buildToneMapFilter({ ...PQ, transfer: 'arib-std-b67', range: 'pc' });
    expect(f).toMatch(/^zscale=tin=arib-std-b67:.*:rin=pc:t=linear/);
  });
});

describe('buildSourceFilter', () => {
  it('deinterlaces flagged frames, then scales', () => {
    expect(buildSourceFilter({ hdr: null }, 'scale=1280:720')).toBe(
      `${DEINTERLACE},scale=1280:720`,
    );
  });

  it('tone-maps HDR after the scale, so the float pass runs on the smaller frame', () => {
    expect(buildSourceFilter({ hdr: PQ }, 'scale=1920:1080')).toBe(
      `${DEINTERLACE},scale=1920:1080,${buildToneMapFilter(PQ)}`,
    );
  });
});

describe('buildFilterComplex', () => {
  it('prepares the chosen video stream once at the top size, then scales each copy to 8-bit 4:2:0', () => {
    const variants = selectRenditions(1280, 720);
    expect(buildFilterComplex({ ...SDR, videoStreamIndex: 2 }, variants)).toBe(
      `[0:2]${DEINTERLACE},scale=1280:720,split=3[v0][v1][v2];` +
        '[v0]scale=1280:720,setsar=1,format=yuv420p[v0out];' +
        '[v1]scale=960:540,setsar=1,format=yuv420p[v1out];' +
        '[v2]scale=640:360,setsar=1,format=yuv420p[v2out]',
    );
  });

  it('keeps a portrait source portrait', () => {
    const fc = buildFilterComplex(SDR, selectRenditions(1080, 1920));
    expect(fc).toContain('[v0]scale=1080:1920,setsar=1,format=yuv420p[v0out]');
    expect(fc).toContain('[v3]scale=360:640,setsar=1,format=yuv420p[v3out]');
    expect(fc).not.toContain('pad=');
  });

  it('tone-maps an HDR source before the split', () => {
    const fc = buildFilterComplex({ ...SDR, hdr: PQ }, selectRenditions(3840, 2160));
    expect(fc.split(';')[0]).toBe(
      `[0:0]${DEINTERLACE},scale=1920:1080,${buildToneMapFilter(PQ)},split=4[v0][v1][v2][v3]`,
    );
  });

  it('forces yuv420p on every rung, which 10-bit and 4:2:2 sources need for libx264 High', () => {
    const fc = buildFilterComplex(SDR, selectRenditions(1920, 1080));
    expect(fc.match(/format=yuv420p\[v\dout\]/g)).toHaveLength(4);
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

describe('INPUT_OPTIONS', () => {
  it('allows only local files and container demuxers, never playlists or concat', () => {
    expect(INPUT_OPTIONS).toEqual([
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      ALLOWED_DEMUXERS.join(','),
    ]);
    for (const banned of ['hls', 'concat', 'dash', 'image2', 'ffmetadata', 'lavfi', 'tee']) {
      expect(ALLOWED_DEMUXERS).not.toContain(banned);
    }
    expect(ALLOWED_DEMUXERS).toEqual(expect.arrayContaining(['mov', 'matroska', 'mpegts']));
  });
});

describe('buildTranscodeArgs', () => {
  const twoRungs = selectRenditions(1280, 720, '720p').filter((v) => v.name !== '540p');

  it('produces the exact argument list for two renditions with audio', () => {
    const source: SourceVideo = { ...SDR, displayWidth: 1280, displayHeight: 720 };
    const args = buildTranscodeArgs({
      inputPath: '/in/source.mov',
      outputDir: '/out/asset-1',
      source,
      variants: twoRungs,
      threads: 3,
    });
    expect(args).toEqual([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-v',
      'error',
      '-nostats',
      '-progress',
      'pipe:1',
      ...INPUT_OPTIONS,
      '-i',
      '/in/source.mov',
      '-filter_complex',
      buildFilterComplex(source, twoRungs),
      '-map',
      '[v0out]',
      '-map',
      '0:1',
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
      '0:1',
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
      'high',
      '-preset',
      'veryfast',
      '-threads',
      '3',
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

  it('maps exactly one audio stream per rendition, the one the probe chose', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: { ...SDR, audioStreamIndex: 3 },
      variants: selectRenditions(1920, 1080),
      threads: 1,
    });
    expect(countOf(args, '-map')).toBe(8);
    expect(countOf(args, '0:3')).toBe(4);
    // `0:a` would map every audio track and break var_stream_map
    expect(args).not.toContain('0:a');
  });

  it('sets codec, bitrate, maxrate and bufsize per output stream for the full ladder', () => {
    const variants = selectRenditions(3840, 2160, '2160p');
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: { ...SDR, displayWidth: 3840, displayHeight: 2160 },
      variants,
      threads: 1,
    });
    variants.forEach((r, i) => {
      expect(valueOf(args, `-c:v:${i}`)).toBe('libx264');
      expect(valueOf(args, `-b:v:${i}`)).toBe(r.videoBitrate);
      expect(valueOf(args, `-maxrate:v:${i}`)).toBe(r.maxRate);
      expect(valueOf(args, `-bufsize:v:${i}`)).toBe(r.bufSize);
      expect(valueOf(args, `-b:a:${i}`)).toBe(r.audioBitrate);
    });
    expect(args.indexOf('-c:v:6')).toBe(-1);
    expect(valueOf(args, '-var_stream_map')).toBe(
      'v:0,a:0,name:2160p v:1,a:1,name:1440p v:2,a:2,name:1080p ' +
        'v:3,a:3,name:720p v:4,a:4,name:540p v:5,a:5,name:360p',
    );
  });

  it('maps each video output right before its own codec options', () => {
    const variants = selectRenditions(1920, 1080);
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: { ...SDR, audioStreamIndex: null },
      variants,
      threads: 1,
    });
    variants.forEach((_, i) => {
      const map = args.indexOf(`[v${i}out]`);
      expect(args[map - 1]).toBe('-map');
      expect(args[map + 1]).toBe(`-c:v:${i}`);
    });
  });

  it('omits every audio option when the source has no audio', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: { ...SDR, audioStreamIndex: null },
      variants: selectRenditions(960, 540),
      threads: 1,
    });
    expect(args.some((a) => /^0:\d+$/.test(a))).toBe(false);
    expect(args).not.toContain('-c:a');
    expect(args).not.toContain('-ac');
    expect(args).not.toContain('-ar');
    expect(args.some((a) => a.startsWith('-b:a'))).toBe(false);
    expect(countOf(args, '-map')).toBe(2);
    expect(valueOf(args, '-var_stream_map')).toBe('v:0,name:540p v:1,name:360p');
  });

  it('cuts the output where the video ends when audio runs on past it', () => {
    const base = {
      inputPath: '/in.mp4',
      outputDir: '/out',
      variants: selectRenditions(640, 360),
      threads: 1,
    };
    const trimmed = buildTranscodeArgs({ ...base, source: { ...SDR, trimSeconds: 4 } });
    expect(valueOf(trimmed, '-t')).toBe('4.000');
    expect(trimmed.indexOf('-t')).toBeLessThan(trimmed.indexOf('-f'));
    expect(buildTranscodeArgs({ ...base, source: SDR })).not.toContain('-t');
  });

  it('encodes High profile with the veryfast preset, not Constrained Baseline', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: SDR,
      variants: selectRenditions(640, 360),
      threads: 4,
    });
    expect(valueOf(args, '-profile:v')).toBe('high');
    expect(valueOf(args, '-preset')).toBe('veryfast');
    expect(valueOf(args, '-threads')).toBe('4');
  });

  it('reports errors only, and progress on stdout', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: SDR,
      variants: selectRenditions(640, 360),
      threads: 1,
    });
    expect(valueOf(args, '-v')).toBe('error');
    expect(valueOf(args, '-progress')).toBe('pipe:1');
    expect(args).toContain('-nostats');
    expect(args).toContain('-nostdin');
    // the whitelists are input options, so they come before -i
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('-i'));
    expect(args.indexOf('-format_whitelist')).toBeLessThan(args.indexOf('-i'));
  });

  it('forces a keyframe every 2s with scene-cut keyframes off, so segments cut cleanly', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: SDR,
      variants: selectRenditions(640, 360),
      threads: 1,
    });
    expect(valueOf(args, '-force_key_frames')).toBe(
      `expr:gte(t,n_forced*${KEYFRAME_INTERVAL_SECONDS})`,
    );
    expect(valueOf(args, '-sc_threshold')).toBe('0');
    expect(HLS_SEGMENT_SECONDS % KEYFRAME_INTERVAL_SECONDS).toBe(0);
    expect(valueOf(args, '-hls_time')).toBe(String(HLS_SEGMENT_SECONDS));
  });

  it('writes vod HLS with single_file fMP4 output', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: SDR,
      variants: selectRenditions(640, 360),
      threads: 1,
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

  it('places the playlist template last, under the output dir', () => {
    const args = buildTranscodeArgs({
      inputPath: '/uploads/abc/source file.mp4',
      outputDir: '/var/transcode/asset-9/',
      source: SDR,
      variants: selectRenditions(640, 360),
      threads: 1,
    });
    expect(valueOf(args, '-i')).toBe('/uploads/abc/source file.mp4');
    expect(valueOf(args, '-hls_segment_filename')).toBe('/var/transcode/asset-9/%v/data.m4s');
    expect(args[args.length - 1]).toBe('/var/transcode/asset-9/%v/playlist.m3u8');
  });

  it('gives every option flag a value', () => {
    const args = buildTranscodeArgs({
      inputPath: '/in.mp4',
      outputDir: '/out',
      source: { ...SDR, trimSeconds: 2.5 },
      variants: selectRenditions(1920, 1080),
      threads: 1,
    });
    const flagsWithoutValue = new Set(['-hide_banner', '-nostdin', '-y', '-nostats']);
    const rest = args.filter((a) => !flagsWithoutValue.has(a)).slice(0, -1);
    expect(rest.length % 2).toBe(0);
    for (let i = 0; i < rest.length; i += 2) {
      expect(rest[i].startsWith('-')).toBe(true);
      expect(rest[i + 1]).toBeTruthy();
    }
  });
});

describe('buildProbeArgs', () => {
  it('asks ffprobe for JSON with format and streams, printing errors and pinning the inputs', () => {
    expect(buildProbeArgs('/in/a.mp4')).toEqual([
      '-v',
      'error',
      ...INPUT_OPTIONS,
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

  it('plans shots at 0s for a zero-length or negative duration', () => {
    expect(planThumbnails(0, '/o').map((s) => s.timeSeconds)).toEqual([0, 0, 0]);
    expect(planThumbnails(-5, '/o').map((s) => s.timeSeconds)).toEqual([0, 0, 0]);
  });
});

describe('buildThumbnailArgs', () => {
  it('seeks before the input, grabs one frame of the chosen stream and letterboxes it to 640x360', () => {
    expect(
      buildThumbnailArgs('/in.mp4', 12.345, '/out/thumb_25.jpg', {
        videoStreamIndex: 1,
        hdr: null,
      }),
    ).toEqual([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-v',
      'error',
      ...INPUT_OPTIONS,
      '-ss',
      '12.34',
      '-i',
      '/in.mp4',
      '-map',
      '0:1',
      '-frames:v',
      '1',
      '-vf',
      `${DEINTERLACE},scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
        'pad=640:360:(ow-iw)/2:(oh-ih)/2',
      '-q:v',
      '2',
      '/out/thumb_25.jpg',
    ]);
  });

  it('tone-maps HDR thumbnails like the renditions', () => {
    const args = buildThumbnailArgs('/in.mp4', 1, '/o.jpg', { videoStreamIndex: 0, hdr: PQ });
    expect(valueOf(args, '-vf')).toContain(`,${buildToneMapFilter(PQ)},pad=640:360`);
  });

  it('formats the seek time with two decimals, rounded down so it never passes the last frame', () => {
    const src = { videoStreamIndex: 0, hdr: null };
    expect(valueOf(buildThumbnailArgs('/i', 3, '/o.jpg', src), '-ss')).toBe('3.00');
    expect(valueOf(buildThumbnailArgs('/i', 0.004, '/o.jpg', src), '-ss')).toBe('0.00');
    // 75% of a 4-frame clip at 24 fps is the last frame's start, 0.125 s
    expect(valueOf(buildThumbnailArgs('/i', 0.125, '/o.jpg', src), '-ss')).toBe('0.12');
  });
});
