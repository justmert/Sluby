import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../config/logger.js';
import {
  MASTER_PLAYLIST_FILENAME,
  buildProbeArgs,
  buildTranscodeArgs,
  selectRenditions,
} from './ffmpeg-args.js';

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
    const proc = spawn('ffprobe', buildProbeArgs(inputPath));

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

  const variants = selectRenditions(probe.height ?? 0);

  logger.info(
    { sourceHeight: probe.height, renditions: variants.map((v) => v.name) },
    'Selected rendition ladder',
  );

  // Create variant directories
  for (const v of variants) {
    await mkdir(path.join(outputDir, v.name), { recursive: true });
  }

  const args = buildTranscodeArgs({ inputPath, outputDir, variants, hasAudio: probe.hasAudio });

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

      const masterPlaylistPath = path.join(outputDir, MASTER_PLAYLIST_FILENAME);

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
