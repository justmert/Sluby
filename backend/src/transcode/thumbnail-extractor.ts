import { spawn } from 'node:child_process';
import path from 'node:path';
import { logger } from '../config/logger.js';

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
  const positions = [0.25, 0.5, 0.75];
  const paths: string[] = [];
  for (const position of positions) {
    const timeSeconds = (durationMs / 1000) * position;
    const outputPath = path.join(outputDir, `thumb_${Math.round(position * 100)}.jpg`);
    logger.debug({ position, timeSeconds, outputPath }, 'Extracting thumbnail');
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
    const args = [
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
