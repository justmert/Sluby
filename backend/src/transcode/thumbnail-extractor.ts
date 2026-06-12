import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadAndPin } from '../storage/sia-client.js';
import { logger } from '../config/logger.js';

/**
 * Extract thumbnails at 25%, 50%, and 75% of video duration,
 * upload each to Sia, and return the object IDs.
 */
export async function extractAndUploadThumbnails(
  inputPath: string,
  durationMs: number,
  outputDir: string,
): Promise<string[]> {
  const positions = [0.25, 0.50, 0.75];
  const thumbnailObjectIds: string[] = [];

  for (const position of positions) {
    const timeSeconds = (durationMs / 1000) * position;
    const outputPath = path.join(outputDir, `thumb_${Math.round(position * 100)}.jpg`);

    logger.debug({ position, timeSeconds, outputPath }, 'Extracting thumbnail');

    await extractThumbnail(inputPath, timeSeconds, outputPath);

    const thumbnailData = await readFile(outputPath);
    const { objectId } = await uploadAndPin(new Uint8Array(thumbnailData));
    thumbnailObjectIds.push(objectId);

    logger.info({ position, objectId }, 'Thumbnail uploaded to Sia');
  }

  return thumbnailObjectIds;
}

async function extractThumbnail(
  inputPath: string,
  timeSeconds: number,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-ss', timeSeconds.toFixed(2),
      '-i', inputPath,
      '-vframes', '1',
      '-vf', 'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2',
      '-q:v', '2',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (data) => { stderr += data.toString(); });

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
