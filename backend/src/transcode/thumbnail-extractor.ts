import { spawn } from 'node:child_process';
import { logger } from '../config/logger.js';
import { buildThumbnailArgs, planThumbnails } from './ffmpeg-args.js';

/**
 * Extract thumbnails at 25%, 50%, and 75% of the video duration to
 * disk. Returns the local file paths so the caller can upload them in
 * a packed Sia batch alongside the variant playlists (see
 * uploadSegments). Decoupled from upload so we can pack many small
 * files into one Sia operation.
 */
export async function extractThumbnails(
  inputPath: string,
  durationMs: number,
  outputDir: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (const { timeSeconds, outputPath } of planThumbnails(durationMs, outputDir)) {
    logger.debug({ timeSeconds, outputPath }, 'Extracting thumbnail');
    await extractThumbnail(inputPath, timeSeconds, outputPath);
    paths.push(outputPath);
  }
  return paths;
}

async function extractThumbnail(
  inputPath: string,
  timeSeconds: number,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = buildThumbnailArgs(inputPath, timeSeconds, outputPath);

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Thumbnail extraction failed (code ${code}): ${stderr.slice(-300)}`));
        return;
      }
      resolve();
    });

    proc.on('error', reject);
  });
}
