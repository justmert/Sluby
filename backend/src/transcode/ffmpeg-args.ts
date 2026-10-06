import path from 'node:path';

/** One rung of the HLS ladder. Bitrates are ffmpeg rate strings. */
export interface Rendition {
  name: string;
  width: number;
  height: number;
  videoBitrate: string;
  maxRate: string;
  bufSize: string;
  audioBitrate: string;
}

export const RENDITION_LADDER: readonly Rendition[] = [
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
 * The rungs to produce for a source of the given height.
 *
 * Do not upscale: keep only rungs at or below the source height, so a small
 * source is not padded up into a fake "1080p" rung with a misleading bitrate.
 * Always keep at least the smallest rung so tiny sources still transcode. An
 * unknown height (0) keeps the full ladder.
 */
export function selectRenditions(sourceHeight: number): Rendition[] {
  const capped =
    sourceHeight > 0
      ? RENDITION_LADDER.filter((v) => v.height <= sourceHeight)
      : [...RENDITION_LADDER];
  return capped.length > 0 ? capped : [RENDITION_LADDER[RENDITION_LADDER.length - 1]];
}

/**
 * Split the decoded video once per rendition, then scale each copy to fit its
 * box (keeping the aspect ratio) and pad it to the exact box size.
 */
export function buildFilterComplex(variants: readonly Rendition[]): string {
  const splitFilter = `[0:v]split=${variants.length}${variants.map((_, i) => `[v${i}]`).join('')}`;
  const scaleFilters = variants.map(
    (v, i) =>
      `[v${i}]scale=w=${v.width}:h=${v.height}:force_original_aspect_ratio=decrease,pad=${v.width}:${v.height}:(ow-iw)/2:(oh-ih)/2[v${i}out]`,
  );
  return [splitFilter, ...scaleFilters].join(';');
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
  variants: readonly Rendition[];
  hasAudio: boolean;
}

/** Full ffmpeg argument list for the multi-rendition HLS fMP4 transcode. */
export function buildTranscodeArgs({
  inputPath,
  outputDir,
  variants,
  hasAudio,
}: TranscodeArgsInput): string[] {
  const args: string[] = [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    '-filter_complex',
    buildFilterComplex(variants),
  ];

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    args.push('-map', `[v${i}out]`);
    if (hasAudio) args.push('-map', '0:a');
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

  if (hasAudio) {
    for (let i = 0; i < variants.length; i++) {
      args.push(`-b:a:${i}`, variants[i].audioBitrate);
    }
    args.push('-c:a', 'aac', '-ac', '2', '-ar', '48000');
  }

  args.push(
    '-profile:v',
    'main',
    '-preset',
    'ultrafast',
    '-threads',
    '0',
    '-force_key_frames',
    `expr:gte(t,n_forced*${KEYFRAME_INTERVAL_SECONDS})`,
    '-sc_threshold',
    '0',
    '-f',
    'hls',
    '-hls_time',
    String(HLS_SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_segment_type',
    'fmp4',
    // single_file: produce ONE big .m4s per variant containing init + all
    // segments concatenated. The playlist references segments via
    // EXT-X-BYTERANGE. This pairs with Sia's native byte-range download
    // support: the gateway can serve any segment by translating an HTTP
    // Range request into sdk.downloadObject(id, {offset,length}).
    // Reduces ~128 Sia uploads per video to ~9 (4 data + 4 playlists +
    // 1 master) and keeps caching efficient (one warm download serves
    // every segment range).
    '-hls_flags',
    'independent_segments+single_file',
    '-master_pl_name',
    MASTER_PLAYLIST_FILENAME,
    // With single_file, the segment filename becomes the single output
    // file per variant rather than a numbered template.
    '-hls_segment_filename',
    path.join(outputDir, `%v/${VARIANT_DATA_FILENAME}`),
    '-var_stream_map',
    buildVarStreamMap(variants, hasAudio),
    path.join(outputDir, `%v/${VARIANT_PLAYLIST_FILENAME}`),
  );

  return args;
}

/** ffprobe arguments that print the container and stream info as JSON. */
export function buildProbeArgs(inputPath: string): string[] {
  return ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath];
}

/** Fractions of the duration at which thumbnails are taken. */
export const THUMBNAIL_POSITIONS = [0.25, 0.5, 0.75] as const;

export interface ThumbnailShot {
  timeSeconds: number;
  outputPath: string;
}

/** Where and when each thumbnail is taken. */
export function planThumbnails(durationMs: number, outputDir: string): ThumbnailShot[] {
  return THUMBNAIL_POSITIONS.map((position) => ({
    timeSeconds: (durationMs / 1000) * position,
    outputPath: path.join(outputDir, `thumb_${Math.round(position * 100)}.jpg`),
  }));
}

/** ffmpeg arguments that grab one 640x360 letterboxed JPEG frame at `timeSeconds`. */
export function buildThumbnailArgs(
  inputPath: string,
  timeSeconds: number,
  outputPath: string,
): string[] {
  return [
    '-y',
    '-ss',
    timeSeconds.toFixed(2),
    '-i',
    inputPath,
    '-vframes',
    '1',
    '-vf',
    'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2',
    '-q:v',
    '2',
    outputPath,
  ];
}
