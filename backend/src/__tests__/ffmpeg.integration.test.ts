import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { transcode, type TranscodeResult } from '../transcode/ffmpeg-runner.js';
import { extractThumbnails } from '../transcode/thumbnail-extractor.js';
import {
  parseMasterVariants,
  parseVariantPlaylist,
  rewriteVariantPlaylist,
} from '../transcode/manifest-rewriter.js';

/**
 * Runs the real ffmpeg/ffprobe binaries over small generated clips, through
 * the same transcode() and extractThumbnails() the pipeline uses, and checks
 * the HLS output the rest of the system depends on (single_file fMP4 with
 * byte ranges). Skips only when ffmpeg is not installed; CI installs it and
 * refuses to skip.
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
  console.warn(
    '\n[ffmpeg.integration] ffmpeg/ffprobe not found on PATH: skipping the real ' +
      'transcode test. Install ffmpeg to run it locally; CI installs it.\n',
  );
}

interface ProbedStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
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

function makeClip(
  file: string,
  opts: { width: number; height: number; seconds: number; audio: boolean },
) {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
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
  execFileSync('ffmpeg', args, { stdio: 'ignore' });
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

    it('writes a master playlist listing each rendition with its box size and both codecs', () => {
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
      for (const l of streamInf) expect(l).toMatch(/CODECS="avc1\.[0-9a-f]+,mp4a\.40\.2"/);
    });

    it('writes single_file fMP4 playlists with EXT-X-MAP and contiguous EXT-X-BYTERANGE entries', () => {
      let totalSegments = 0;
      for (const dir of result.variantDirs) {
        const playlist = readFileSync(path.join(dir, 'playlist.m3u8'), 'utf8');
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

    it('encodes each rendition at its box size with h264 video and stereo 48 kHz aac audio', () => {
      const boxes: Record<string, [number, number]> = {
        '720p': [1280, 720],
        '540p': [960, 540],
        '360p': [640, 360],
      };
      for (const [name, [w, h]] of Object.entries(boxes)) {
        const streams = probeStreams(path.join(out, name, 'data.m4s'));
        const video = streams.find((s) => s.codec_type === 'video')!;
        const audio = streams.find((s) => s.codec_type === 'audio')!;
        expect(video).toMatchObject({ codec_name: 'h264', width: w, height: h });
        expect(audio).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 });
      }
    });

    it('produces playlists the rewriter turns into gateway URLs without losing byte ranges', () => {
      const playlist = readFileSync(path.join(out, '720p', 'playlist.m3u8'), 'utf8');
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
      makeClip(src, { width: 360, height: 640, seconds: 3, audio: false });
      result = await transcode(src, out);
    }, 120_000);

    it('picks rungs by source height and pillarboxes into landscape boxes', () => {
      expect(result.resolution).toBe('360x640');
      expect(result.variantDirs).toEqual(['540p', '360p'].map((n) => path.join(out, n)));
      for (const [name, w, h] of [
        ['540p', 960, 540],
        ['360p', 640, 360],
      ] as const) {
        const streams = probeStreams(path.join(out, name, 'data.m4s'));
        expect(streams.map((s) => s.codec_type)).toEqual(['video']);
        expect(streams[0]).toMatchObject({ codec_name: 'h264', width: w, height: h });
      }
    });

    it('writes a video-only master playlist', () => {
      const master = readFileSync(result.masterPlaylistPath, 'utf8');
      expect(parseMasterVariants(master).map((v) => v.path)).toEqual([
        '540p/playlist.m3u8',
        '360p/playlist.m3u8',
      ]);
      expect(master).not.toContain('mp4a');
      for (const dir of result.variantDirs) {
        const { segs } = parseRanges(readFileSync(path.join(dir, 'playlist.m3u8'), 'utf8'));
        expect(segs).toHaveLength(1);
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

  it('rejects with ffmpeg stderr when the input is not a video', async () => {
    const bogus = path.join(work, 'not-a-video.mp4');
    execFileSync('sh', ['-c', `printf 'hello' > "${bogus}"`]);
    await expect(transcode(bogus, path.join(work, 'bogus-out'))).rejects.toThrow(
      /ffprobe exited with code/,
    );
  });
});
