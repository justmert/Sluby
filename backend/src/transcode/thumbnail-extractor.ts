import { stat } from 'node:fs/promises';
import { logger } from '../config/logger.js';
import { buildThumbnailArgs, planThumbnails } from './ffmpeg-args.js';
import { THUMBNAIL_TIMEOUT_MS, probeSource, runFfmpegTool } from './ffmpeg-runner.js';

/**
 * Extract thumbnails at 25%, 50% and 75% of the video to disk and return the
 * paths that were written, for the upload stage to pack with the media.
 *
 * Thumbnails are best effort: a shot that fails or comes out empty is logged
 * and skipped, so a source whose frames cannot be grabbed still finishes as
 * a video. The source is probed again for its video stream and colour (HDR
 * thumbnails are tone-mapped like the renditions), and the shots are kept
 * inside the video stream even when `durationMs` came from a longer
 * container.
 */
export async function extractThumbnails(
  inputPath: string,
  durationMs: number,
  outputDir: string,
): Promise<string[]> {
  let source: Awaited<ReturnType<typeof probeSource>>;
  try {
    source = await probeSource(inputPath);
  } catch (err) {
    logger.warn({ err, inputPath }, 'Skipping thumbnails: the source could not be probed');
    return [];
  }
  const videoMs = source.durationMs > 0 ? Math.min(durationMs, source.durationMs) : durationMs;

  const paths: string[] = [];
  for (const { timeSeconds, outputPath } of planThumbnails(videoMs, outputDir)) {
    logger.debug({ timeSeconds, outputPath }, 'Extracting thumbnail');
    try {
      await runFfmpegTool(
        'ffmpeg',
        buildThumbnailArgs(inputPath, timeSeconds, outputPath, source),
        {
          label: 'Thumbnail extraction',
          timeoutMs: THUMBNAIL_TIMEOUT_MS,
        },
      );
      const { size } = await stat(outputPath);
      if (size === 0) throw new Error(`${outputPath} is empty`);
      paths.push(outputPath);
    } catch (err) {
      logger.warn({ err, inputPath, timeSeconds, outputPath }, 'Skipping thumbnail');
    }
  }
  return paths;
}
