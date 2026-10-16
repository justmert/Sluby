import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { transcode, type TranscodeResult } from '../transcode/ffmpeg-runner.js';
import { UnreadableSourceError } from '../transcode/source-errors.js';
import { extractThumbnails } from '../transcode/thumbnail-extractor.js';
import {
  parseMasterVariants,
  parseVariantPlaylist,
  rewriteVariantPlaylist,
} from '../transcode/manifest-rewriter.js';

/**
 * Runs the real ffmpeg/ffprobe binaries over small clips generated here,
 * through the same transcode() and extractThumbnails() the pipeline uses, and
 * checks the HLS output the rest of the system depends on (single_file fMP4
 * with byte ranges). The clips cover the inputs that used to fail or come out
 * wrong: 10-bit, 4:2:2, HDR, two audio tracks, trailing audio, portrait,
 * rotation, interlacing, variable frame rate, very short, 4K, broken files.
 * Skips only when ffmpeg is not installed; CI installs it and refuses to
 * skip. The HDR cases need ffmpeg built with zimg (the zscale filter), as the
 * backend image and Debian or Ubuntu packages are; Homebrew's is not.
 */

function binaryPresent(name: string): boolean {
  try {
    execFileSync(name, ['-version'], { stdio: 'ignore' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

const HAS_FFMPEG = binaryPresent('ffmpeg') && binaryPresent('ffprobe');
if (!HAS_FFMPEG) {
  if (process.env.CI) {
    throw new Error(
      'ffmpeg/ffprobe not found on PATH, but CI must run the ffmpeg integration test',
    );
  }
  // straight to stderr: vitest drops console output of a file whose tests all skip
  process.stderr.write(
    '\n[ffmpeg.integration] ffmpeg/ffprobe not found on PATH: skipping the real ' +
      'transcode test. Install ffmpeg to run it locally; CI installs it.\n\n',
  );
}

const HAS_ZSCALE =
  HAS_FFMPEG &&
  /^\s*\S+\s+zscale\s/m.test(execFileSync('ffmpeg', ['-hide_banner', '-filters']).toString());
if (HAS_FFMPEG && !HAS_ZSCALE) {
  if (process.env.CI) {
    throw new Error('ffmpeg has no zscale filter, but CI must run the HDR transcode cases');
  }
  process.stderr.write(
    '\n[ffmpeg.integration] this ffmpeg has no zscale filter (built without zimg): ' +
      'skipping the HDR cases. The backend image and CI run them.\n\n',
  );
}

interface ProbedStream {
  codec_type: string;
  codec_name: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  color_transfer?: string;
  color_primaries?: string;
  sample_aspect_ratio?: string;
}

function probeStreams(file: string): ProbedStream[] {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    file,
  ]);
  return (JSON.parse(out.toString()) as { streams: ProbedStream[] }).streams;
}

/** Run ffmpeg quietly; the clips are made from lavfi sources, no files needed. */
function ff(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function makeClip(
  file: string,
  opts: { width: number; height: number; seconds: number; audio: boolean },
) {
  const args = [
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${opts.width}x${opts.height}:rate=24:duration=${opts.seconds}`,
  ];
  if (opts.audio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${opts.seconds}`);
  }
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (opts.audio) args.push('-c:a', 'aac', '-shortest');
  args.push(file);
  ff(args);
}

/**
 * SDR BT.709 to the given HDR transfer in BT.2020, with SDR white at 203
 * nits as ITU-R BT.2408 places it, which is how SDR material sits in HDR.
 */
function sdrToHdr(transfer: string) {
  return (
    'zscale=tin=bt709:min=bt709:pin=bt709:rin=tv:t=linear:npl=203:p=bt709,format=gbrpf32le,' +
    `zscale=p=bt2020:t=${transfer}:m=bt2020nc:r=tv:npl=203,format=yuv420p10le`
  );
}

/** A flat 10-bit HEVC patch at `signal` (0..1 of the limited range), tagged HDR. */
function makeHdrPatch(file: string, signal: number, transfer: 'smpte2084' | 'arib-std-b67') {
  ff([
    '-f',
    'lavfi',
    '-i',
    'color=c=gray:s=640x360:r=24:d=1',
    '-vf',
    // setparams tags the frames; -color_trc alone loses to the untagged lavfi frames
    `format=yuv420p10le,geq=lum=${Math.round(64 + signal * 876)}:cb=512:cr=512,` +
      `setparams=color_trc=${transfer}:color_primaries=bt2020:colorspace=bt2020nc:range=tv`,
    '-c:v',
    'libx265',
    '-x265-params',
    'log-level=error:lossless=1',
    '-color_primaries',
    'bt2020',
    '-color_trc',
    transfer,
    '-colorspace',
    'bt2020nc',
    file,
  ]);
}

/** Mean of a signalstats value (YAVG, SATAVG) over the frames of `file`. */
function signalAverage(file: string, key: 'YAVG' | 'SATAVG'): number {
  const out = execFileSync('ffmpeg', [
    '-hide_banner',
    '-v',
    'error',
    '-i',
    file,
    '-vf',
    `format=yuv420p,signalstats,metadata=print:key=lavfi.signalstats.${key}:file=-`,
    '-f',
    'null',
    '-',
  ]).toString();
  const values = [...out.matchAll(new RegExp(`${key}=([\\d.]+)`, 'g'))].map((m) => Number(m[1]));
  if (values.length === 0) throw new Error(`no ${key} for ${file}`);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** A 10-bit HEVC HDR copy of an SDR clip, tagged like a phone recording. */
function makeHdrClip(sdr: string, file: string, transfer: 'smpte2084' | 'arib-std-b67') {
  ff([
    '-i',
    sdr,
    '-vf',
    sdrToHdr(transfer),
    '-c:v',
    'libx265',
    '-preset',
    'ultrafast',
    '-x265-params',
    'log-level=error',
    '-crf',
    '12',
    '-tag:v',
    'hvc1',
    '-color_primaries',
    'bt2020',
    '-color_trc',
    transfer,
    '-colorspace',
    'bt2020nc',
    '-c:a',
    'copy',
    file,
  ]);
}

/** Mean volume in dB of the audio in `file`. */
function meanVolume(file: string): number {
  const r = spawnSync('ffmpeg', [
    '-hide_banner',
    '-i',
    file,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);
  const m = r.stderr.toString().match(/mean_volume: (-?[\d.]+|-inf) dB/);
  if (!m) throw new Error(`no volume in ffmpeg output: ${r.stderr.toString().slice(-500)}`);
  return m[1] === '-inf' ? -Infinity : Number(m[1]);
}

/** Frames idet calls interlaced and progressive over the first `frames` frames. */
function interlaceCounts(file: string, frames = 40): { interlaced: number; progressive: number } {
  const r = spawnSync('ffmpeg', [
    '-hide_banner',
    '-i',
    file,
    '-vf',
    'idet',
    '-frames:v',
    String(frames),
    '-f',
    'null',
    '-',
  ]);
  // the filter is set up twice and reports both times; the last report counts
  const m = [
    ...r.stderr
      .toString()
      .matchAll(/Multi frame detection: TFF:\s*(\d+) BFF:\s*(\d+) Progressive:\s*(\d+)/g),
  ].at(-1);
  if (!m) throw new Error(`no idet in ffmpeg output: ${r.stderr.toString().slice(-500)}`);
  return { interlaced: Number(m[1]) + Number(m[2]), progressive: Number(m[3]) };
}

interface Segment {
  duration: number;
  length: number;
  offset: number;
}

/** Map range and media segments of a single_file playlist, in order. */
function parseRanges(playlist: string): {
  map: { length: number; offset: number };
  segs: Segment[];
} {
  const mapMatch = playlist.match(/#EXT-X-MAP:URI="data\.m4s",BYTERANGE="(\d+)@(\d+)"/);
  if (!mapMatch) throw new Error('no EXT-X-MAP with BYTERANGE');
  const map = { length: Number(mapMatch[1]), offset: Number(mapMatch[2]) };
  const segs: Segment[] = [];
  const lines = playlist.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const inf = lines[i].match(/^#EXTINF:([\d.]+),/);
    if (!inf) continue;
    const br = lines[i + 1].match(/^#EXT-X-BYTERANGE:(\d+)@(\d+)$/);
    if (!br) throw new Error(`EXTINF at line ${i} is not followed by EXT-X-BYTERANGE`);
    expect(lines[i + 2]).toBe('data.m4s');
    segs.push({ duration: Number(inf[1]), length: Number(br[1]), offset: Number(br[2]) });
  }
  return { map, segs };
}

function playlistOf(dir: string): string {
  return readFileSync(path.join(dir, 'playlist.m3u8'), 'utf8');
}

function playlistSeconds(dir: string): number {
  return parseRanges(playlistOf(dir)).segs.reduce((sum, s) => sum + s.duration, 0);
}

/** The encoded video stream of one rendition. */
function renditionVideo(dir: string): ProbedStream {
  return probeStreams(path.join(dir, 'data.m4s')).find((s) => s.codec_type === 'video')!;
}

const rungNames = (r: TranscodeResult) => r.variantDirs.map((d) => path.basename(d));

describe.skipIf(!HAS_FFMPEG)('ffmpeg integration (real binaries)', () => {
  let work: string;

  beforeAll(() => {
    work = mkdtempSync(path.join(tmpdir(), 'sluby-ffmpeg-itest-'));
  });

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe('720p landscape source with audio', () => {
    const SECONDS = 13;
    let src: string;
    let out: string;
    let result: TranscodeResult;
    const progress: number[] = [];

    beforeAll(async () => {
      src = path.join(work, 'landscape.mp4');
      out = path.join(work, 'landscape-out');
      makeClip(src, { width: 1280, height: 720, seconds: SECONDS, audio: true });
      result = await transcode(src, out, { onProgress: (p) => void progress.push(p) });
    }, 120_000);

    it('reports the probed source and the renditions it produced', () => {
      expect(result.resolution).toBe('1280x720');
      expect(Math.abs(result.durationMs - SECONDS * 1000)).toBeLessThan(150);
      expect(result.masterPlaylistPath).toBe(path.join(out, 'master.m3u8'));
      expect(result.variantDirs).toEqual(['720p', '540p', '360p'].map((n) => path.join(out, n)));
      expect(existsSync(path.join(out, '1080p'))).toBe(false);
    });

    it('reports ffmpeg progress up to completion', () => {
      expect(progress.length).toBeGreaterThan(0);
      expect(Math.max(...progress)).toBeGreaterThanOrEqual(90);
      expect(progress.every((p) => p >= 0 && p <= 100)).toBe(true);
    });

    it('writes a master playlist listing each rendition with its size and High profile codecs', () => {
      const master = readFileSync(result.masterPlaylistPath, 'utf8');
      const variants = parseMasterVariants(master);
      expect(variants.map((v) => [v.path, v.width, v.height])).toEqual([
        ['720p/playlist.m3u8', 1280, 720],
        ['540p/playlist.m3u8', 960, 540],
        ['360p/playlist.m3u8', 640, 360],
      ]);
      for (const v of variants) expect(v.bandwidthKbps).toBeGreaterThan(0);
      const streamInf = master.split('\n').filter((l) => l.startsWith('#EXT-X-STREAM-INF'));
      expect(streamInf).toHaveLength(3);
      // avc1.64xxxx is High; ultrafast with -profile:v main gave 42 (Constrained Baseline)
      for (const l of streamInf) expect(l).toMatch(/CODECS="avc1\.64[0-9a-f]{4},mp4a\.40\.2"/);
    });

    it('writes single_file fMP4 playlists with EXT-X-MAP and contiguous EXT-X-BYTERANGE entries', () => {
      let totalSegments = 0;
      for (const dir of result.variantDirs) {
        const playlist = playlistOf(dir);
        expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
        expect(playlist).toContain('#EXT-X-INDEPENDENT-SEGMENTS');
        expect(playlist).toContain('#EXT-X-ENDLIST');
        expect(playlist).toMatch(/#EXT-X-MAP:URI="data\.m4s",BYTERANGE="\d+@0"/);
        expect(playlist).toMatch(/^#EXT-X-BYTERANGE:\d+@\d+$/m);

        const { map, segs } = parseRanges(playlist);
        // 13s at a 6s target cut on 2s keyframes: 6 + 6 + 1
        expect(segs.map((s) => Math.round(s.duration))).toEqual([6, 6, 1]);
        const target = Number(playlist.match(/#EXT-X-TARGETDURATION:(\d+)/)![1]);
        expect(target).toBe(6);

        // the init section then each segment, back to back, covering the
        // whole data file: what the gateway's range translation relies on
        let next = map.offset + map.length;
        for (const s of segs) {
          expect(s.offset).toBe(next);
          expect(s.length).toBeGreaterThan(0);
          next = s.offset + s.length;
        }
        expect(next).toBe(statSync(path.join(dir, 'data.m4s')).size);

        // only the one data file per rendition, no numbered segments
        expect(existsSync(path.join(dir, 'data0.m4s'))).toBe(false);

        const parsed = parseVariantPlaylist(playlist);
        expect(parsed).toEqual({ dataFilename: 'data.m4s', segmentCount: 3 });
        totalSegments += segs.length;
      }
      expect(result.segmentCount).toBe(totalSegments);
    });

    it('encodes each rendition at its size with h264 High 4:2:0 video and stereo 48 kHz aac audio', () => {
      const boxes: Record<string, [number, number]> = {
        '720p': [1280, 720],
        '540p': [960, 540],
        '360p': [640, 360],
      };
      for (const [name, [w, h]] of Object.entries(boxes)) {
        const streams = probeStreams(path.join(out, name, 'data.m4s'));
        const video = streams.find((s) => s.codec_type === 'video')!;
        const audio = streams.filter((s) => s.codec_type === 'audio');
        expect(video).toMatchObject({
          codec_name: 'h264',
          profile: 'High',
          pix_fmt: 'yuv420p',
          width: w,
          height: h,
        });
        expect(audio).toHaveLength(1);
        expect(audio[0]).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 });
      }
    });

    it('produces playlists the rewriter turns into gateway URLs without losing byte ranges', () => {
      const playlist = playlistOf(path.join(out, '720p'));
      const rewritten = rewriteVariantPlaylist(
        playlist,
        { dataObjectId: 'obj720', dataFilename: 'data.m4s' },
        'https://gw.example',
      );
      expect(rewritten).not.toMatch(/^data\.m4s$/m);
      expect(rewritten).toMatch(
        /#EXT-X-MAP:URI="https:\/\/gw\.example\/v1\/objects\/obj720",BYTERANGE="\d+@0"/,
      );
      const before = playlist.match(/^#EXT-X-BYTERANGE:.*$/gm);
      const after = rewritten.match(/^#EXT-X-BYTERANGE:.*$/gm);
      expect(after).toEqual(before);
    });
  });

  describe('portrait source without audio', () => {
    let src: string;
    let out: string;
    let result: TranscodeResult;

    beforeAll(async () => {
      src = path.join(work, 'portrait.mp4');
      out = path.join(work, 'portrait-out');
      makeClip(src, { width: 720, height: 1280, seconds: 3, audio: false });
      result = await transcode(src, out);
    }, 120_000);

    it('picks rungs by the short side and keeps every rung portrait, without padding', () => {
      expect(result.resolution).toBe('720x1280');
      expect(rungNames(result)).toEqual(['720p', '540p', '360p']);
      for (const [name, w, h] of [
        ['720p', 720, 1280],
        ['540p', 540, 960],
        ['360p', 360, 640],
      ] as const) {
        const streams = probeStreams(path.join(out, name, 'data.m4s'));
        expect(streams.map((s) => s.codec_type)).toEqual(['video']);
        expect(streams[0]).toMatchObject({ codec_name: 'h264', width: w, height: h });
      }
      const master = readFileSync(result.masterPlaylistPath, 'utf8');
      expect(master).toContain('RESOLUTION=720x1280');
    });

    it('writes a video-only master playlist', () => {
      const master = readFileSync(result.masterPlaylistPath, 'utf8');
      expect(parseMasterVariants(master).map((v) => v.path)).toEqual([
        '720p/playlist.m3u8',
        '540p/playlist.m3u8',
        '360p/playlist.m3u8',
      ]);
      expect(master).not.toContain('mp4a');
      for (const dir of result.variantDirs) {
        expect(parseRanges(playlistOf(dir)).segs).toHaveLength(1);
      }
    });

    it('extracts three letterboxed 640x360 jpeg thumbnails', async () => {
      const thumbs = await extractThumbnails(src, result.durationMs, out);
      expect(thumbs).toEqual(
        ['thumb_25.jpg', 'thumb_50.jpg', 'thumb_75.jpg'].map((f) => path.join(out, f)),
      );
      for (const t of thumbs) {
        const [stream] = probeStreams(t);
        expect(stream).toMatchObject({ codec_name: 'mjpeg', width: 640, height: 360 });
      }
    });
  });

  it('turns a landscape-coded clip with 90 degree rotation into portrait renditions', async () => {
    const coded = path.join(work, 'coded.mp4');
    const src = path.join(work, 'rotated.mp4');
    const out = path.join(work, 'rotated-out');
    makeClip(coded, { width: 1280, height: 720, seconds: 2, audio: false });
    ff(['-display_rotation', '90', '-i', coded, '-c', 'copy', src]);
    const result = await transcode(src, out);
    expect(result.resolution).toBe('720x1280');
    expect(rungNames(result)).toEqual(['720p', '540p', '360p']);
    expect(renditionVideo(result.variantDirs[0])).toMatchObject({ width: 720, height: 1280 });
    expect(await extractThumbnails(src, result.durationMs, out)).toHaveLength(3);
  }, 120_000);

  describe.each([
    ['10-bit H.264', 'libx264', 'yuv420p10le', 'h264'],
    ['10-bit HEVC', 'libx265', 'yuv420p10le', 'hevc'],
    ['4:2:2 H.264', 'libx264', 'yuv422p', 'h264'],
    ['10-bit 4:2:2 H.264', 'libx264', 'yuv422p10le', 'h264'],
  ])('%s source', (_label, encoder, pixFmt, codec) => {
    let src: string;
    let result: TranscodeResult;

    beforeAll(async () => {
      src = path.join(work, `${encoder}-${pixFmt}.mp4`);
      ff([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=640x360:rate=24:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=2',
        '-c:v',
        encoder,
        '-preset',
        'ultrafast',
        ...(encoder === 'libx265' ? ['-x265-params', 'log-level=error', '-tag:v', 'hvc1'] : []),
        '-pix_fmt',
        pixFmt,
        '-c:a',
        'aac',
        src,
      ]);
      const [video] = probeStreams(src);
      expect(video).toMatchObject({ codec_name: codec, pix_fmt: pixFmt });
      result = await transcode(src, path.join(work, `${encoder}-${pixFmt}-out`));
    }, 120_000);

    it('transcodes to 8-bit 4:2:0 H.264 High', () => {
      expect(rungNames(result)).toEqual(['360p']);
      expect(renditionVideo(result.variantDirs[0])).toMatchObject({
        codec_name: 'h264',
        profile: 'High',
        pix_fmt: 'yuv420p',
        width: 640,
        height: 360,
      });
    });

    it('extracts its thumbnails', async () => {
      expect(
        await extractThumbnails(src, result.durationMs, path.dirname(result.variantDirs[0])),
      ).toHaveLength(3);
    });
  });

  describe.skipIf(!HAS_ZSCALE).each([
    ['PQ', 'smpte2084'],
    ['HLG', 'arib-std-b67'],
  ] as const)('HDR %s source (10-bit HEVC)', (label, transfer) => {
    let sdr: string;
    let src: string;
    let out: string;
    let result: TranscodeResult;

    beforeAll(async () => {
      sdr = path.join(work, `sdr-for-${label}.mp4`);
      src = path.join(work, `hdr-${label}.mp4`);
      out = path.join(work, `hdr-${label}-out`);
      ff([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1280x720:rate=24:duration=2',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '10',
        '-pix_fmt',
        'yuv420p',
        sdr,
      ]);
      makeHdrClip(sdr, src, transfer);
      const [video] = probeStreams(src);
      expect(video).toMatchObject({ pix_fmt: 'yuv420p10le', color_transfer: transfer });
      result = await transcode(src, out);
    }, 180_000);

    it('transcodes to SDR BT.709 8-bit H.264 High', () => {
      expect(rungNames(result)).toEqual(['720p', '540p', '360p']);
      for (const dir of result.variantDirs) {
        expect(renditionVideo(dir)).toMatchObject({
          codec_name: 'h264',
          profile: 'High',
          pix_fmt: 'yuv420p',
          color_transfer: 'bt709',
          color_primaries: 'bt709',
        });
      }
    });

    it('keeps the colour of the SDR picture instead of showing the HDR signal washed out', () => {
      // the clip is SDR content carried in HDR. Passing the 10-bit values
      // through as SDR, which is what the ladder did before, leaves a
      // greyish picture at a quarter to a third of the saturation; tone
      // mapping keeps most of it (highlights are rolled off a little)
      const passedThrough = path.join(work, `hdr-${label}-passthrough.mp4`);
      ff(['-i', src, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '10', passedThrough]);
      const original = signalAverage(sdr, 'SATAVG');
      const washedOut = signalAverage(passedThrough, 'SATAVG');
      expect(washedOut).toBeLessThan(original * 0.5);
      for (const name of ['720p', '360p']) {
        const mapped = signalAverage(path.join(out, name, 'data.m4s'), 'SATAVG');
        expect(mapped).toBeGreaterThan(original * 0.7);
        expect(mapped).toBeGreaterThan(washedOut * 1.5);
      }
    });

    it('maps 18% grey and reference white to their SDR levels', async () => {
      // ITU-R BT.2408 signal levels: 18% grey is 38% for both, reference
      // white 58% in PQ and 75% in HLG. SDR 18% grey is 8-bit luma 106 and
      // white 235; mobius leaves reference white some room below 235.
      const levels = { grey: 0.38, white: transfer === 'smpte2084' ? 0.58 : 0.75 };
      const luma: Record<string, number> = {};
      for (const [name, signal] of Object.entries(levels)) {
        const patch = path.join(work, `patch-${label}-${name}.mp4`);
        makeHdrPatch(patch, signal, transfer);
        const r = await transcode(patch, path.join(work, `patch-${label}-${name}-out`));
        luma[name] = signalAverage(path.join(r.variantDirs[0], 'data.m4s'), 'YAVG');
      }
      expect(luma.grey).toBeGreaterThan(98);
      expect(luma.grey).toBeLessThan(118);
      // passed through untouched, white would sit near 143 (PQ) or 180 (HLG)
      expect(luma.white).toBeGreaterThan(190);
      expect(luma.white).toBeLessThanOrEqual(236);
    }, 120_000);

    it('tone-maps its thumbnails too', async () => {
      const thumbs = await extractThumbnails(src, result.durationMs, out);
      expect(thumbs).toHaveLength(3);
      const reference = path.join(work, `sdr-${label}-thumb.png`);
      ff(['-ss', '1.00', '-i', sdr, '-frames:v', '1', '-vf', 'scale=640:360', reference]);
      expect(signalAverage(thumbs[1], 'SATAVG')).toBeGreaterThan(
        signalAverage(reference, 'SATAVG') * 0.7,
      );
    });
  });

  it('keeps one audio track, the default one, from a source with two', async () => {
    const src = path.join(work, 'two-audio.mp4');
    const out = path.join(work, 'two-audio-out');
    // track 0 is silent, track 1 is a tone and the default
    ff([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=24:duration=2',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=2',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-disposition:a:0',
      '0',
      '-disposition:a:1',
      'default',
      src,
    ]);
    expect(probeStreams(src).filter((s) => s.codec_type === 'audio')).toHaveLength(2);
    const result = await transcode(src, out);
    const data = path.join(result.variantDirs[0], 'data.m4s');
    expect(probeStreams(data).filter((s) => s.codec_type === 'audio')).toHaveLength(1);
    expect(meanVolume(data)).toBeGreaterThan(-40);
    expect(readFileSync(result.masterPlaylistPath, 'utf8')).toContain('mp4a.40.2');
  }, 120_000);

  it('ends a clip whose audio runs past the video where the video ends, with thumbnails', async () => {
    const src = path.join(work, 'trailing-audio.mp4');
    const out = path.join(work, 'trailing-audio-out');
    ff([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=24:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=20',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      src,
    ]);
    const result = await transcode(src, out);
    expect(result.durationMs).toBe(2000);
    expect(playlistSeconds(result.variantDirs[0])).toBeCloseTo(2, 0);
    const audio = probeStreams(path.join(result.variantDirs[0], 'data.m4s')).find(
      (s) => s.codec_type === 'audio',
    )!;
    expect(Number(audio.duration ?? '0')).toBeLessThan(2.5);
    // these shots used to land at 5, 10 and 15 s, after the last frame
    const thumbs = await extractThumbnails(src, result.durationMs, out);
    expect(thumbs).toHaveLength(3);
  }, 120_000);

  it('deinterlaces an interlaced source', async () => {
    const src = path.join(work, 'interlaced.mp4');
    const out = path.join(work, 'interlaced-out');
    ff([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=50:duration=2,interlace',
      '-flags',
      '+ildct+ilme',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      src,
    ]);
    const before = interlaceCounts(src);
    expect(before.interlaced).toBeGreaterThan(before.progressive);
    const result = await transcode(src, out);
    const after = interlaceCounts(path.join(result.variantDirs[0], 'data.m4s'));
    expect(after.progressive).toBeGreaterThan(after.interlaced);
  }, 120_000);

  it('transcodes a variable frame rate source', async () => {
    const src = path.join(work, 'vfr.mp4');
    ff([
      '-f',
      'lavfi',
      '-i',
      "testsrc2=s=640x360:r=30:d=4,setpts='if(lt(N,30),N/60/TB,(N-15)/30/TB)'",
      '-fps_mode',
      'vfr',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      src,
    ]);
    const result = await transcode(src, path.join(work, 'vfr-out'));
    expect(Math.abs(result.durationMs - 3500)).toBeLessThan(200);
    expect(
      Math.abs(playlistSeconds(result.variantDirs[0]) - result.durationMs / 1000),
    ).toBeLessThan(0.2);
  }, 120_000);

  it('transcodes a 0.2 second clip with thumbnails', async () => {
    const src = path.join(work, 'short.mp4');
    const out = path.join(work, 'short-out');
    makeClip(src, { width: 640, height: 360, seconds: 0.2, audio: true });
    const result = await transcode(src, out);
    expect(result.durationMs).toBeLessThan(300);
    expect(result.segmentCount).toBe(1);
    expect(await extractThumbnails(src, result.durationMs, out)).toHaveLength(3);
  }, 120_000);

  describe('4K source', () => {
    let src: string;

    beforeAll(() => {
      src = path.join(work, 'uhd.mp4');
      makeClip(src, { width: 3840, height: 2160, seconds: 1, audio: true });
    }, 120_000);

    it('tops out at 1080p by default', async () => {
      const result = await transcode(src, path.join(work, 'uhd-default-out'));
      expect(result.resolution).toBe('3840x2160');
      expect(rungNames(result)).toEqual(['1080p', '720p', '540p', '360p']);
    }, 120_000);

    it('adds 1440p and 2160p when the ladder is raised to 2160p', async () => {
      const result = await transcode(src, path.join(work, 'uhd-2160-out'), {
        maxRendition: '2160p',
      });
      expect(rungNames(result)).toEqual(['2160p', '1440p', '1080p', '720p', '540p', '360p']);
      expect(renditionVideo(result.variantDirs[0])).toMatchObject({ width: 3840, height: 2160 });
      expect(renditionVideo(result.variantDirs[1])).toMatchObject({ width: 2560, height: 1440 });
      const master = readFileSync(result.masterPlaylistPath, 'utf8');
      expect(parseMasterVariants(master)).toHaveLength(6);
    }, 180_000);

    it.skipIf(!HAS_ZSCALE)(
      'takes a 10-bit HLG 4K phone-style clip through the 2160p ladder as SDR',
      async () => {
        const hlg = path.join(work, 'uhd-hlg.mp4');
        makeHdrClip(src, hlg, 'arib-std-b67');
        const result = await transcode(hlg, path.join(work, 'uhd-hlg-out'), {
          maxRendition: '2160p',
        });
        expect(rungNames(result)).toEqual(['2160p', '1440p', '1080p', '720p', '540p', '360p']);
        expect(renditionVideo(result.variantDirs[0])).toMatchObject({
          width: 3840,
          height: 2160,
          pix_fmt: 'yuv420p',
          profile: 'High',
          color_transfer: 'bt709',
        });
      },
      300_000,
    );
  });

  describe('inputs that cannot be transcoded', () => {
    it('names the cause for a file that is not a video', async () => {
      const bogus = path.join(work, 'not-a-video.mp4');
      writeFileSync(bogus, 'hello');
      const failure = transcode(bogus, path.join(work, 'bogus-out'));
      await expect(failure).rejects.toThrow(
        /^ffprobe exited with code 1: .*Invalid data found when processing input/,
      );
      await expect(failure).rejects.toBeInstanceOf(UnreadableSourceError);
    });

    it('names the cause for a zero-length file', async () => {
      const empty = path.join(work, 'empty.mp4');
      writeFileSync(empty, '');
      await expect(transcode(empty, path.join(work, 'empty-out'))).rejects.toThrow(
        /^ffprobe exited with code 1: .*(Invalid data found|End of file)/,
      );
    });

    it('names the cause for a truncated mp4', async () => {
      const full = path.join(work, 'whole.mp4');
      const cut = path.join(work, 'truncated.mp4');
      makeClip(full, { width: 640, height: 360, seconds: 2, audio: true });
      const bytes = readFileSync(full);
      writeFileSync(cut, bytes.subarray(0, Math.floor(bytes.length / 2)));
      await expect(transcode(cut, path.join(work, 'truncated-out'))).rejects.toThrow(
        /^ffprobe exited with code 1: .*moov atom not found/,
      );
    });

    it('refuses an ffconcat upload that would read a neighbouring file', async () => {
      // tus stores uploads without an extension, side by side in one directory
      const neighbour = path.join(work, 'neighbour.mp4');
      makeClip(neighbour, { width: 640, height: 360, seconds: 1, audio: false });
      const concat = path.join(work, 'upload');
      writeFileSync(concat, "ffconcat version 1.0\nfile 'neighbour.mp4'\n");
      await expect(transcode(concat, path.join(work, 'concat-out'))).rejects.toThrow(
        /^ffprobe exited with code 1: .*Format not on whitelist/,
      );
    });
  });
});
