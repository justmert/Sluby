import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  MASTER_PLAYLIST_FILENAME,
  VARIANT_PLAYLIST_FILENAME,
  buildProbeArgs,
  buildTranscodeArgs,
  selectRenditions,
  type HdrColor,
  type RenditionName,
  type SourceVideo,
} from './ffmpeg-args.js';
import { UnreadableSourceError } from './source-errors.js';

export interface TranscodeResult {
  masterPlaylistPath: string;
  variantDirs: string[];
  segmentCount: number;
  /** length of the video stream, which is what the output plays */
  durationMs: number;
  /** coded size as shown, so a portrait phone clip reads 1080x1920 */
  resolution: string;
}

export interface TranscodeOptions {
  onProgress?: (percent: number) => void;
  /** tallest rung to make; defaults to TRANSCODE_MAX_RENDITION */
  maxRendition?: RenditionName;
}

/** Transcode jobs the worker runs at once; FFmpeg threads are sized to share the cores. */
export const TRANSCODE_CONCURRENCY = 2;

/** libx264 threads per encoder, so concurrent transcodes split the cores instead of each claiming all of them. */
export function encoderThreads(cores = availableParallelism()): number {
  return Math.max(1, Math.floor(cores / TRANSCODE_CONCURRENCY));
}

export const PROBE_TIMEOUT_MS = 60_000;
export const THUMBNAIL_TIMEOUT_MS = 60_000;

/**
 * Wall-clock limit for one transcode. A hung FFmpeg would otherwise hold its
 * job forever, since the worker's lock keeps renewing. Generous on purpose:
 * a 10-bit HLG 4K source into the 2160p ladder ran at 22x its length on two
 * cores, so slow hardware gets room, and the stall limit below catches a hang
 * long before this. A source of unknown length gets a flat limit.
 */
export function transcodeTimeoutMs(durationMs: number): number {
  if (!(durationMs > 0)) return 12 * 60 * 60 * 1000;
  return 30 * 60 * 1000 + durationMs * 60;
}

/** A transcode whose output time has not moved for this long is hung. */
export const TRANSCODE_STALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Keeps the start and the end of a process's output with a fixed bound, so a
 * long run that prints an error per frame cannot grow memory without limit.
 */
export class BoundedOutput {
  private head = '';
  private tail = '';
  private dropped = 0;

  constructor(private readonly limit = 16 * 1024) {}

  push(chunk: string): void {
    let rest = chunk;
    if (this.head.length < this.limit) {
      const room = this.limit - this.head.length;
      this.head += rest.slice(0, room);
      rest = rest.slice(room);
    }
    if (!rest) return;
    const joined = this.tail + rest;
    const over = joined.length - this.limit;
    if (over > 0) this.dropped += over;
    this.tail = over > 0 ? joined.slice(over) : joined;
  }

  /** The first part of the output, where the cause of a failure is printed. */
  start(): string {
    return this.head;
  }

  toString(): string {
    if (!this.tail) return this.head;
    return this.dropped > 0
      ? `${this.head}\n[${this.dropped} characters dropped]\n${this.tail}`
      : this.head + this.tail;
  }
}

/**
 * The first distinct lines of an error-level FFmpeg log: the cause comes
 * first, the generic "Conversion failed" and teardown lines after it.
 * Context addresses ("[libx264 @ 0x6000...]") are dropped so the message
 * reads the same every run.
 */
export function summarizeFfmpegErrors(output: string, maxLines = 5, maxLength = 600): string {
  const lines: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(/ @ 0x[0-9a-f]+\]/gi, ']').trim();
    if (!line || /^Last message repeated \d+ times$/.test(line)) continue;
    if (lines.includes(line)) continue;
    lines.push(line);
    if (lines.length === maxLines) break;
  }
  const text = lines.join('; ');
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

export interface RunOptions {
  /** name used in error messages, e.g. "FFmpeg" */
  label: string;
  timeoutMs: number;
  /** keep stdout and resolve with it (ffprobe's JSON), up to this many characters */
  captureStdout?: number;
  /** kill the run when `progressed` has not been called for this long */
  stallTimeoutMs?: number;
  onStdout?: (chunk: string, progressed: () => void) => void;
}

/**
 * Run ffmpeg or ffprobe to completion. Rejects with the command's own error
 * lines on a non-zero exit, and SIGKILLs it when a time limit passes:
 * SIGKILL rather than SIGTERM, because FFmpeg finishes the HLS playlists on
 * SIGTERM and a truncated video would look complete.
 */
export function runFfmpegTool(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr = new BoundedOutput();
    let stdout = '';
    let settled = false;
    let killedFor: string | null = null;

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stallTimer) clearTimeout(stallTimer);
      if (err) reject(err);
      else resolve(stdout);
    };

    const kill = (reason: string) => {
      killedFor = reason;
      proc.kill('SIGKILL');
    };
    const timer = setTimeout(
      () => kill(`timed out after ${Math.round(options.timeoutMs / 1000)}s`),
      options.timeoutMs,
    );
    const stallMs = options.stallTimeoutMs;
    const stallTimer =
      stallMs === undefined
        ? null
        : setTimeout(() => kill(`made no progress for ${Math.round(stallMs / 1000)}s`), stallMs);
    const progressed = () => {
      stallTimer?.refresh();
    };

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      options.onStdout?.(chunk, progressed);
      if (options.captureStdout === undefined) return;
      stdout += chunk;
      if (stdout.length > options.captureStdout) {
        proc.kill('SIGKILL');
        finish(new Error(`${options.label} printed more than ${options.captureStdout} characters`));
      }
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr.push(data.toString());
    });

    proc.on('close', (code, signal) => {
      if (killedFor) {
        finish(new Error(`${options.label} ${killedFor} and was killed`));
        return;
      }
      if (code === 0) {
        finish(null);
        return;
      }
      logger.error({ command, code, signal, stderr: stderr.toString() }, `${options.label} failed`);
      const cause = summarizeFfmpegErrors(stderr.start()) || 'no error output';
      const how = code === null ? `was killed by ${signal}` : `exited with code ${code}`;
      finish(new Error(`${options.label} ${how}: ${cause}`));
    });

    proc.on('error', (err) => {
      finish(new Error(`${options.label} spawn error: ${err.message}`));
    });
  });
}

export interface ProbedSource extends SourceVideo {
  /** video stream length, or the container's when the stream has none */
  durationMs: number;
  /** coded size with rotation applied */
  width: number;
  height: number;
  formatName: string;
}

interface FfprobeStream {
  index: number;
  codec_type?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  color_range?: string;
  start_time?: string;
  duration?: string;
  disposition?: { default?: number; attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: Array<{ rotation?: number | string }>;
}

interface FfprobeOutput {
  format?: { duration?: string; start_time?: string; format_name?: string };
  streams?: FfprobeStream[];
}

function seconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Matroska keeps stream lengths in a DURATION tag such as "00:00:04.000000000". */
function tagSeconds(value: string | undefined): number | null {
  const m = value?.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function rotationOf(stream: FfprobeStream): number {
  const fromSideData = stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation;
  const raw = Number(fromSideData ?? stream.tags?.rotate ?? 0);
  return Number.isFinite(raw) ? ((Math.round(raw) % 360) + 360) % 360 : 0;
}

function sampleAspect(value: string | undefined): number {
  const m = value?.match(/^(\d+):(\d+)$/);
  if (!m || Number(m[1]) === 0 || Number(m[2]) === 0) return 1;
  return Number(m[1]) / Number(m[2]);
}

const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
const KNOWN_PRIMARIES = new Set(['bt2020', 'bt709', 'smpte432', 'smpte431']);
const KNOWN_MATRICES = new Set(['bt2020nc', 'bt2020c', 'bt709']);

function hdrColorOf(stream: FfprobeStream): HdrColor | null {
  if (!stream.color_transfer || !HDR_TRANSFERS.has(stream.color_transfer)) return null;
  // PQ and HLG footage is BT.2020 in practice; assume it when untagged
  return {
    transfer: stream.color_transfer as HdrColor['transfer'],
    primaries:
      stream.color_primaries && KNOWN_PRIMARIES.has(stream.color_primaries)
        ? stream.color_primaries
        : 'bt2020',
    matrix:
      stream.color_space && KNOWN_MATRICES.has(stream.color_space)
        ? stream.color_space
        : 'bt2020nc',
    range: stream.color_range === 'pc' ? 'pc' : 'tv',
  };
}

/** Audio that runs on this far past the video is cut; less is normal encoder padding. */
const TRIM_TOLERANCE_SECONDS = 0.5;

/** Read what the transcode needs from ffprobe's JSON. */
export function parseProbeOutput(json: string): ProbedSource {
  let info: FfprobeOutput;
  try {
    info = JSON.parse(json) as FfprobeOutput;
  } catch (err) {
    throw new Error(`Failed to parse ffprobe output: ${(err as Error).message}`, { cause: err });
  }
  const streams = info.streams ?? [];
  // cover art in mp4 and mkv is a video stream too
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!video) throw new UnreadableSourceError('No video stream found');
  if (!(video.width! > 0) || !(video.height! > 0)) {
    throw new Error('The video stream has no frame size');
  }
  const audios = streams.filter((s) => s.codec_type === 'audio');
  const audio = audios.find((s) => s.disposition?.default === 1) ?? audios[0];

  const rotated = rotationOf(video) % 180 === 90;
  const codedWidth = video.width!;
  const codedHeight = video.height!;
  const shownWidth = codedWidth * sampleAspect(video.sample_aspect_ratio);

  const containerSeconds = seconds(info.format?.duration);
  const videoSeconds = seconds(video.duration) ?? tagSeconds(video.tags?.DURATION);
  const durationSeconds = videoSeconds ?? containerSeconds ?? 0;

  // ffmpeg starts the output at the container's start time
  let trimSeconds: number | null = null;
  if (audio && videoSeconds !== null && containerSeconds !== null) {
    const offset = (seconds(video.start_time) ?? 0) - (seconds(info.format?.start_time) ?? 0);
    const videoEnd = Math.max(0, offset) + videoSeconds;
    if (containerSeconds - videoEnd > TRIM_TOLERANCE_SECONDS) trimSeconds = videoEnd;
  }

  return {
    videoStreamIndex: video.index,
    audioStreamIndex: audio ? audio.index : null,
    displayWidth: rotated ? codedHeight : shownWidth,
    displayHeight: rotated ? shownWidth : codedHeight,
    hdr: hdrColorOf(video),
    trimSeconds,
    durationMs: Math.round(durationSeconds * 1000),
    width: rotated ? codedHeight : codedWidth,
    height: rotated ? codedWidth : codedHeight,
    formatName: info.format?.format_name ?? '',
  };
}

export async function probeSource(inputPath: string): Promise<ProbedSource> {
  let json: string;
  try {
    json = await runFfmpegTool('ffprobe', buildProbeArgs(inputPath), {
      label: 'ffprobe',
      timeoutMs: PROBE_TIMEOUT_MS,
      captureStdout: 8 * 1024 * 1024,
    });
  } catch (err) {
    // ffprobe's own words for bytes that are no media file it knows; a
    // timeout or a crash stays an ordinary, retried failure
    const message = (err as Error).message;
    if (/Invalid data found when processing input/.test(message)) {
      throw new UnreadableSourceError(message, { cause: err });
    }
    throw err;
  }
  return parseProbeOutput(json);
}

/** Count the segments of a variant playlist FFmpeg wrote; a missing or empty one fails the transcode. */
async function countSegments(variantDir: string): Promise<number> {
  const playlistPath = path.join(variantDir, VARIANT_PLAYLIST_FILENAME);
  let content: string;
  try {
    content = await readFile(playlistPath, 'utf8');
  } catch (err) {
    throw new Error(`FFmpeg finished without writing ${playlistPath}: ${(err as Error).message}`, {
      cause: err,
    });
  }
  const count = (content.match(/^#EXTINF:/gm) ?? []).length;
  if (count === 0) throw new Error(`FFmpeg wrote ${playlistPath} without any segment`);
  return count;
}

export async function transcode(
  inputPath: string,
  outputDir: string,
  options: TranscodeOptions = {},
): Promise<TranscodeResult> {
  await mkdir(outputDir, { recursive: true });

  const source = await probeSource(inputPath);
  logger.info({ inputPath, source }, 'Probed video');

  const variants = selectRenditions(
    source.displayWidth,
    source.displayHeight,
    options.maxRendition ?? env.TRANSCODE_MAX_RENDITION,
  );

  logger.info(
    {
      source: `${source.width}x${source.height}`,
      renditions: variants.map((v) => `${v.name} ${v.width}x${v.height}`),
    },
    'Selected rendition ladder',
  );

  for (const v of variants) {
    await mkdir(path.join(outputDir, v.name), { recursive: true });
  }

  const threads = encoderThreads();
  const args = buildTranscodeArgs({ inputPath, outputDir, source, variants, threads });
  logger.info({ args: args.join(' ') }, 'Starting FFmpeg transcode');

  // -progress prints key=value lines; a line can be split across chunks
  let pending = '';
  let lastOutTimeUs = -1;
  const onStdout = (chunk: string, progressed: () => void) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const m = line.match(/^out_time_us=(\d+)/);
      if (!m) continue;
      // the block repeats every half second even when nothing moves
      const outTimeUs = Number(m[1]);
      if (outTimeUs <= lastOutTimeUs) continue;
      lastOutTimeUs = outTimeUs;
      progressed();
      if (!options.onProgress || source.durationMs <= 0) continue;
      const percent = Math.min(100, Math.round((outTimeUs / 1000 / source.durationMs) * 100));
      // onProgress is async (it writes job progress to the DB). Without a
      // catch, a rejected update becomes an unhandled rejection on every
      // ffmpeg progress tick; progress reporting must never kill the job.
      void Promise.resolve(options.onProgress(percent)).catch((err) => {
        logger.warn({ err }, 'Progress callback failed');
      });
    }
  };

  await runFfmpegTool('ffmpeg', args, {
    label: 'FFmpeg',
    timeoutMs: transcodeTimeoutMs(source.durationMs),
    stallTimeoutMs: TRANSCODE_STALL_TIMEOUT_MS,
    onStdout,
  });

  const variantDirs = variants.map((v) => path.join(outputDir, v.name));
  let segmentCount = 0;
  for (const dir of variantDirs) segmentCount += await countSegments(dir);

  const masterPlaylistPath = path.join(outputDir, MASTER_PLAYLIST_FILENAME);
  logger.info({ masterPlaylistPath, variantDirs, segmentCount }, 'FFmpeg transcode complete');

  return {
    masterPlaylistPath,
    variantDirs,
    segmentCount,
    durationMs: source.durationMs,
    resolution: `${source.width}x${source.height}`,
  };
}
