import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../config/logger.js';

export interface TranscodeResult {
  masterPlaylistPath: string;
  variantDirs: string[];
  segmentCount: number;
  durationMs: number;
  resolution: string;
}

export interface TranscodeOptions {
  onProgress?: (percent: number) => void;
}

interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

async function probeVideo(inputPath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams?.find(
          (s: { codec_type: string }) => s.codec_type === 'video',
        );
        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        const durationMs = Math.round(parseFloat(info.format?.duration ?? '0') * 1000);
        const width = videoStream.width ?? 1920;
        const height = videoStream.height ?? 1080;
        const fpsRatio = videoStream.r_frame_rate ?? '24/1';
        const [fpsNum, fpsDen] = fpsRatio.split('/').map(Number);
        const fps = fpsDen ? fpsNum / fpsDen : 24;
        const hasAudio =
          info.streams?.some((s: { codec_type: string }) => s.codec_type === 'audio') ?? false;

        resolve({ durationMs, width, height, fps, hasAudio });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e}`));
      }
    });

    proc.on('error', reject);
  });
}

export async function transcode(
  inputPath: string,
  outputDir: string,
  options: TranscodeOptions = {},
): Promise<TranscodeResult> {
  await mkdir(outputDir, { recursive: true });

  const probe = await probeVideo(inputPath);
  logger.info({ inputPath, probe }, 'Probed video');

  const keyframeInterval = 2;

  const fullLadder = [
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

  // Do not upscale: keep only rungs at or below the source height, so a small
  // source is not padded up into a fake "1080p" rung with a misleading bitrate.
  // Always keep at least the smallest rung so tiny sources still transcode.
  const sourceHeight = probe.height ?? 0;
  const capped = sourceHeight > 0 ? fullLadder.filter((v) => v.height <= sourceHeight) : fullLadder;
  const variants = capped.length > 0 ? capped : [fullLadder[fullLadder.length - 1]];

  logger.info(
    { sourceHeight, renditions: variants.map((v) => v.name) },
    'Selected rendition ladder',
  );

  // Create variant directories
  for (const v of variants) {
    await mkdir(path.join(outputDir, v.name), { recursive: true });
  }

  // Build filter_complex for scaling
  const splitFilter = `[0:v]split=${variants.length}${variants.map((_, i) => `[v${i}]`).join('')}`;
  const scaleFilters = variants.map(
    (v, i) =>
      `[v${i}]scale=w=${v.width}:h=${v.height}:force_original_aspect_ratio=decrease,pad=${v.width}:${v.height}:(ow-iw)/2:(oh-ih)/2[v${i}out]`,
  );
  const filterComplex = [splitFilter, ...scaleFilters].join(';');

  // Build FFmpeg args
  const args: string[] = ['-hide_banner', '-y', '-i', inputPath, '-filter_complex', filterComplex];

  // Add map and codec settings for each variant
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    args.push('-map', `[v${i}out]`);
    if (probe.hasAudio) args.push('-map', '0:a');
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

  // Audio codec settings (only when audio exists)
  if (probe.hasAudio) {
    for (let i = 0; i < variants.length; i++) {
      args.push(`-b:a:${i}`, variants[i].audioBitrate);
    }
    args.push('-c:a', 'aac', '-ac', '2', '-ar', '48000');
  }

  // var_stream_map: include audio index only when audio exists
  const varStreamMap = variants
    .map((v, i) => (probe.hasAudio ? `v:${i},a:${i},name:${v.name}` : `v:${i},name:${v.name}`))
    .join(' ');

  args.push(
    '-profile:v',
    'main',
    '-preset',
    'ultrafast',
    '-threads',
    '0',
    '-force_key_frames',
    `expr:gte(t,n_forced*${keyframeInterval})`,
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
    // single_file: produce ONE big .m4s per variant containing init + all
    // segments concatenated. The playlist references segments via
    // EXT-X-BYTERANGE. This pairs perfectly with Sia's native byte-range
    // download support — the gateway can serve any segment by translating
    // an HTTP Range request into sdk.downloadObject(id, {offset,length}).
    // Reduces ~128 Sia uploads per video to ~9 (4 data + 4 playlists +
    // 1 master) and keeps caching efficient (one warm download serves
    // every segment range).
    '-hls_flags',
    'independent_segments+single_file',
    '-master_pl_name',
    'master.m3u8',
    // With single_file, the segment filename becomes the single output
    // file per variant rather than a numbered template.
    '-hls_segment_filename',
    path.join(outputDir, '%v/data.m4s'),
    '-var_stream_map',
    varStreamMap,
    path.join(outputDir, '%v/playlist.m3u8'),
  );

  logger.info({ args: args.join(' ') }, 'Starting FFmpeg transcode');

  return new Promise<TranscodeResult>((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse progress from stderr: "time=HH:MM:SS.ss"
      if (options.onProgress && probe.durationMs > 0) {
        const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseInt(timeMatch[3], 10);
          const centiseconds = parseInt(timeMatch[4], 10);
          const currentMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + centiseconds * 10;
          const percent = Math.min(100, Math.round((currentMs / probe.durationMs) * 100));
          // onProgress is async (it writes job progress to the DB). Without a
          // catch, a rejected update becomes an unhandled rejection on every
          // ffmpeg progress tick; progress reporting must never kill the job.
          void Promise.resolve(options.onProgress(percent)).catch((err) => {
            logger.warn({ err }, 'Progress callback failed');
          });
        }
      }
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        logger.error({ code, stderr: stderr.slice(-1000) }, 'FFmpeg transcode failed');
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }

      // Count segments by parsing playlists. With single_file mode each
      // variant has a single data.m4s, but the playlist still references
      // N segments via EXT-X-BYTERANGE. We sum #EXTINF occurrences.
      const variantDirs = variants.map((v) => path.join(outputDir, v.name));
      let totalSegments = 0;
      for (const dir of variantDirs) {
        try {
          const files = await readdir(dir);
          const playlist = files.find((f) => f.endsWith('.m3u8'));
          if (!playlist) continue;
          const { readFile } = await import('node:fs/promises');
          const content = await readFile(path.join(dir, playlist), 'utf8');
          totalSegments += (content.match(/^#EXTINF:/gm) ?? []).length;
        } catch {
          // directory may not exist if variant was skipped
        }
      }

      const masterPlaylistPath = path.join(outputDir, 'master.m3u8');

      logger.info({ masterPlaylistPath, variantDirs, totalSegments }, 'FFmpeg transcode complete');

      resolve({
        masterPlaylistPath,
        variantDirs,
        segmentCount: totalSegments,
        durationMs: probe.durationMs,
        resolution: `${probe.width}x${probe.height}`,
      });
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}
