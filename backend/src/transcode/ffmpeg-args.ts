import path from 'node:path';

/** Rung names, tallest first. */
export const RENDITION_NAMES = ['2160p', '1440p', '1080p', '720p', '540p', '360p'] as const;

export type RenditionName = (typeof RENDITION_NAMES)[number];

/**
 * One rung of the HLS ladder. Bitrates are ffmpeg rate strings. `width` and
 * `height` are the 16:9 landscape size the rung is named after; the encoded
 * frame keeps the source's aspect ratio, with `height` as its short side (see
 * selectRenditions).
 */
export interface Rendition {
  name: RenditionName;
  width: number;
  height: number;
  videoBitrate: string;
  maxRate: string;
  bufSize: string;
  audioBitrate: string;
}

/**
 * Every rung, tallest first. 1440p and 2160p are off unless
 * TRANSCODE_MAX_RENDITION turns them on. Their bitrates continue the
 * 720p to 1080p step (bitrate grows with pixels to the power of about 0.66),
 * with the same 7% maxrate headroom and 1.5x buffer as the other rungs.
 */
export const RENDITION_LADDER: readonly Rendition[] = [
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
];

/** The tallest rung made when TRANSCODE_MAX_RENDITION is not set. */
export const DEFAULT_MAX_RENDITION: RenditionName = '1080p';

/** Seconds between forced keyframes, so every segment starts on one. */
export const KEYFRAME_INTERVAL_SECONDS = 2;

/** Target HLS segment length in seconds (a multiple of the keyframe interval). */
export const HLS_SEGMENT_SECONDS = 6;

/** Filename ffmpeg writes each variant's single_file data to. */
export const VARIANT_DATA_FILENAME = 'data.m4s';

/** Filename of each variant playlist inside its rendition directory. */
export const VARIANT_PLAYLIST_FILENAME = 'playlist.m3u8';

export const MASTER_PLAYLIST_FILENAME = 'master.m3u8';

/**
 * libx264 settings for every rung. veryfast keeps cabac, b-frames, 8x8
 * transforms and mb-tree, which ultrafast turns off; at the ladder's fixed
 * bitrates that is several dB of quality for under twice the encode time.
 * High is the profile those tools need, and every target player decodes it.
 */
export const X264_PRESET = 'veryfast';
export const X264_PROFILE = 'high';

/**
 * Demuxers an upload may be read with. Uploads are untrusted, and playlist
 * style formats (hls, concat, dash, image sequences) make ffmpeg open other
 * files: an ffconcat upload can name a neighbouring upload in the same
 * directory, which concat's safe mode allows.
 */
export const ALLOWED_DEMUXERS = [
  'mov',
  'matroska',
  'webm',
  'avi',
  'mpegts',
  'mpeg',
  'asf',
  'flv',
  'ogg',
  'mxf',
  'dv',
  'rm',
  'nut',
  'ivf',
  'h264',
  'hevc',
  'm4v',
  'mpegvideo',
] as const;

/** Input options for every ffmpeg and ffprobe run on an upload. */
export const INPUT_OPTIONS: readonly string[] = [
  '-protocol_whitelist',
  'file',
  '-format_whitelist',
  ALLOWED_DEMUXERS.join(','),
];

/** HDR transfer functions that are tone-mapped down to SDR. */
export type HdrTransfer = 'smpte2084' | 'arib-std-b67';

/** Colour description of an HDR source, as ffprobe names it. */
export interface HdrColor {
  transfer: HdrTransfer;
  primaries: string;
  matrix: string;
  range: 'tv' | 'pc';
}

/** What the argument builders need to know about the source, from ffprobe. */
export interface SourceVideo {
  /** absolute index of the video stream to transcode */
  videoStreamIndex: number;
  /** absolute index of the one audio stream to keep, null without audio */
  audioStreamIndex: number | null;
  /** shown size: rotation and sample aspect ratio applied */
  displayWidth: number;
  displayHeight: number;
  /** set for PQ and HLG sources */
  hdr: HdrColor | null;
  /** end the output here, when audio runs on past the last video frame */
  trimSeconds: number | null;
}

/** Round to the nearest even number of at least 2, as yuv420p needs. */
function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * The rungs to produce for a source shown at `displayWidth`x`displayHeight`,
 * each sized to keep the source's aspect ratio with the rung's height as its
 * short side, so portrait video gets 1080x1920 rather than a pillarboxed
 * 1920x1080.
 *
 * Only rungs up to `maxRendition` are made. Do not upscale: keep only rungs
 * whose short side fits in the source's, so a small source does not get a
 * fake "1080p" rung with a misleading bitrate. Always keep at least the
 * smallest rung so tiny sources still transcode.
 */
export function selectRenditions(
  displayWidth: number,
  displayHeight: number,
  maxRendition: RenditionName = DEFAULT_MAX_RENDITION,
): Rendition[] {
  if (!(displayWidth > 0) || !(displayHeight > 0)) {
    throw new Error(`Cannot size renditions for a ${displayWidth}x${displayHeight} source`);
  }
  const cap = RENDITION_LADDER.find((r) => r.name === maxRendition);
  if (!cap) throw new Error(`Unknown rendition ${maxRendition}`);
  const shortSide = Math.min(displayWidth, displayHeight);
  const fitting = RENDITION_LADDER.filter((r) => r.height <= cap.height && r.height <= shortSide);
  const rungs = fitting.length > 0 ? fitting : [RENDITION_LADDER[RENDITION_LADDER.length - 1]];
  const landscape = displayWidth >= displayHeight;
  return rungs.map((r) => ({
    ...r,
    width: landscape ? even((r.height * displayWidth) / displayHeight) : r.height,
    height: landscape ? r.height : even((r.height * displayHeight) / displayWidth),
  }));
}

/**
 * Turn PQ or HLG into SDR BT.709 that every player shows correctly: the
 * ladder is 8-bit H.264, which has no HDR signalling browsers act on, so
 * passing the HDR values through would look washed out. zscale linearises
 * with 1.0 at 203 nits, the HDR reference white of ITU-R BT.2408, and
 * converts the primaries; mobius keeps the darks and mid-tones linear and
 * rolls the highlights off. Measured on flat patches, 18% grey comes out at
 * 8-bit luma 109 (SDR's own 18% grey is 106) and reference white at 201, so
 * brighter highlights still have room. The input colour is spelled out
 * because zscale cannot convert from frames tagged unspecified.
 */
export function buildToneMapFilter(hdr: HdrColor): string {
  return [
    `zscale=tin=${hdr.transfer}:min=${hdr.matrix}:pin=${hdr.primaries}:rin=${hdr.range}:t=linear:npl=203:p=${hdr.primaries}`,
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=mobius:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ].join(',');
}

/**
 * The source's own filters: deinterlace frames flagged as interlaced
 * (progressive frames pass through untouched), scale, then tone-map HDR.
 * Tone mapping works on 32-bit float pixels, so it runs after the scale: at
 * 4K it costs more than decoding and encoding together.
 */
export function buildSourceFilter(source: Pick<SourceVideo, 'hdr'>, scale: string): string {
  const filters = ['bwdif=mode=send_frame:deint=interlaced', scale];
  if (source.hdr) filters.push(buildToneMapFilter(source.hdr));
  return filters.join(',');
}

/**
 * Prepare the source once at the tallest rung's size, split it per
 * rendition, then scale each copy to its size as square-pixel 8-bit 4:2:0,
 * the only format libx264's High profile and every player accept (10-bit and
 * 4:2:2 sources included).
 */
export function buildFilterComplex(source: SourceVideo, variants: readonly Rendition[]): string {
  const top = variants[0];
  const split =
    `[0:${source.videoStreamIndex}]${buildSourceFilter(source, `scale=${top.width}:${top.height}`)},` +
    `split=${variants.length}${variants.map((_, i) => `[v${i}]`).join('')}`;
  const scales = variants.map(
    (v, i) => `[v${i}]scale=${v.width}:${v.height},setsar=1,format=yuv420p[v${i}out]`,
  );
  return [split, ...scales].join(';');
}

/** The -var_stream_map value: one entry per rendition, audio paired only when present. */
export function buildVarStreamMap(variants: readonly Rendition[], hasAudio: boolean): string {
  return variants
    .map((v, i) => (hasAudio ? `v:${i},a:${i},name:${v.name}` : `v:${i},name:${v.name}`))
    .join(' ');
}

export interface TranscodeArgsInput {
  inputPath: string;
  outputDir: string;
  source: SourceVideo;
  variants: readonly Rendition[];
  /** libx264 threads per encoder */
  threads: number;
}

/**
 * Full ffmpeg argument list for the multi-rendition HLS fMP4 transcode.
 * Only errors go to stderr, so a failure message is the cause rather than
 * encoder statistics; progress comes as key=value lines on stdout.
 */
export function buildTranscodeArgs({
  inputPath,
  outputDir,
  source,
  variants,
  threads,
}: TranscodeArgsInput): string[] {
  const audio = source.audioStreamIndex;
  const args: string[] = [
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
    inputPath,
    '-filter_complex',
    buildFilterComplex(source, variants),
  ];

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    args.push('-map', `[v${i}out]`);
    // one audio stream per rendition: var_stream_map pairs v:i with a:i only
    if (audio !== null) args.push('-map', `0:${audio}`);
    args.push(
      `-c:v:${i}`,
      'libx264',
      `-b:v:${i}`,
      v.videoBitrate,
      `-maxrate:v:${i}`,
      v.maxRate,
      `-bufsize:v:${i}`,
      v.bufSize,
    );
  }

  if (audio !== null) {
    for (let i = 0; i < variants.length; i++) {
      args.push(`-b:a:${i}`, variants[i].audioBitrate);
    }
    args.push('-c:a', 'aac', '-ac', '2', '-ar', '48000');
  }

  args.push(
    '-profile:v',
    X264_PROFILE,
    '-preset',
    X264_PRESET,
    '-threads',
    String(threads),
    '-force_key_frames',
    `expr:gte(t,n_forced*${KEYFRAME_INTERVAL_SECONDS})`,
    '-sc_threshold',
    '0',
  );

  // audio past the last frame would all land in the final segment while its
  // EXTINF only counts the video
  if (source.trimSeconds !== null) args.push('-t', source.trimSeconds.toFixed(3));

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(HLS_SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_segment_type',
    'fmp4',
    // single_file: one .m4s per variant holding the init section and every
    // segment, addressed by EXT-X-BYTERANGE. The gateway serves a segment by
    // turning the Range request into a ranged Sia download, and the data
    // files go up to Sia in one packed upload.
    '-hls_flags',
    'independent_segments+single_file',
    '-master_pl_name',
    MASTER_PLAYLIST_FILENAME,
    // with single_file this names the one data file per variant
    '-hls_segment_filename',
    path.join(outputDir, `%v/${VARIANT_DATA_FILENAME}`),
    '-var_stream_map',
    buildVarStreamMap(variants, audio !== null),
    path.join(outputDir, `%v/${VARIANT_PLAYLIST_FILENAME}`),
  );

  return args;
}

/** ffprobe arguments that print the container and stream info as JSON. */
export function buildProbeArgs(inputPath: string): string[] {
  return [
    '-v',
    'error',
    ...INPUT_OPTIONS,
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ];
}

/** Fractions of the duration at which thumbnails are taken. */
export const THUMBNAIL_POSITIONS = [0.25, 0.5, 0.75] as const;

export interface ThumbnailShot {
  timeSeconds: number;
  outputPath: string;
}

/** Where and when each thumbnail is taken, `durationMs` being the video's. */
export function planThumbnails(durationMs: number, outputDir: string): ThumbnailShot[] {
  const seconds = Math.max(0, durationMs) / 1000;
  return THUMBNAIL_POSITIONS.map((position) => ({
    timeSeconds: seconds * position,
    outputPath: path.join(outputDir, `thumb_${Math.round(position * 100)}.jpg`),
  }));
}

/** ffmpeg arguments that grab one 640x360 letterboxed JPEG frame at `timeSeconds`. */
export function buildThumbnailArgs(
  inputPath: string,
  timeSeconds: number,
  outputPath: string,
  source: Pick<SourceVideo, 'videoStreamIndex' | 'hdr'>,
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-v',
    'error',
    ...INPUT_OPTIONS,
    // rounded down: rounding up can pass the last frame of a short clip,
    // and the seek then has nothing to grab
    '-ss',
    (Math.floor(timeSeconds * 100) / 100).toFixed(2),
    '-i',
    inputPath,
    '-map',
    `0:${source.videoStreamIndex}`,
    '-frames:v',
    '1',
    '-vf',
    `${buildSourceFilter(source, 'scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2')},` +
      'pad=640:360:(ow-iw)/2:(oh-ih)/2',
    '-q:v',
    '2',
    outputPath,
  ];
}
