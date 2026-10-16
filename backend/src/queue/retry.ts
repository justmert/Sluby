import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../api/middleware/error-handler.js';
import type { TranscodeJobData, UploadSegmentsJobData } from './bull-config.js';

/**
 * Retry of a failed asset, with the database and queues injected so the
 * stage decision is testable without them. `index.ts` wires the real ones.
 */
export interface RetryAssetDeps {
  /** The asset if it exists, is owned by `owner` and is not being deleted. */
  getAsset: (
    id: string,
    owner?: string,
  ) => Promise<{ id: string; status: string; accessTier: string } | undefined>;
  /** The asset's latest processing job, if it has one. */
  getProcessingJob: (
    videoAssetId: string,
  ) => Promise<{ id: string; uploadSessionId: string } | undefined>;
  getUploadSession: (id: string) => Promise<{ filePath: string } | undefined>;
  markAssetProcessing: (id: string) => Promise<void>;
  /** Back to processing with the previous error cleared. */
  markJobProcessing: (jobId: string) => Promise<void>;
  enqueueUploadSegments: (data: UploadSegmentsJobData, jobId: string) => Promise<void>;
  enqueueTranscode: (data: TranscodeJobData, jobId: string) => Promise<void>;
  /** Root under which each asset's transcode output lives, in `<root>/<assetId>`. */
  transcodeOutputDir: string;
  now?: () => number;
}

export type RetryStage = 'upload-segments' | 'transcode';

/**
 * Build the `retryAsset` handler behind POST /assets/:id/retry. A transcode
 * that already finished on disk is not redone: the retry resumes at the Sia
 * upload. Otherwise the source upload is transcoded again, which needs the
 * uploaded file to still be on disk.
 */
export function buildRetryAsset(deps: RetryAssetDeps) {
  const now = deps.now ?? Date.now;

  return async (id: string, owner?: string): Promise<{ stage: RetryStage }> => {
    const asset = await deps.getAsset(id, owner);
    if (!asset) throw new AppError(404, 'Video asset not found');
    if (asset.status !== 'failed') throw new AppError(400, 'Asset is not in failed state');

    const processingJob = await deps.getProcessingJob(id);
    const uploadSessionId = processingJob?.uploadSessionId ?? '';

    const outputDir = path.join(deps.transcodeOutputDir, id);
    const hasTranscodedOutput = existsSync(path.join(outputDir, 'master.m3u8'));

    if (hasTranscodedOutput) {
      await deps.markAssetProcessing(id);
      if (processingJob) await deps.markJobProcessing(processingJob.id);
      // Re-attach any thumbnails still on disk from the transcode stage, so a
      // retried upload does not end up with an empty thumbnailObjectIds.
      const thumbnailPaths = [25, 50, 75]
        .map((p) => path.join(outputDir, `thumb_${p}.jpg`))
        .filter((tp) => existsSync(tp));

      await deps.enqueueUploadSegments(
        {
          videoAssetId: id,
          uploadSessionId,
          outputDir,
          accessTier: asset.accessTier,
          thumbnailPaths,
        },
        `retry-upload-${id}-${now()}`,
      );
      return { stage: 'upload-segments' };
    }

    const session = uploadSessionId ? await deps.getUploadSession(uploadSessionId) : undefined;
    if (!session?.filePath || !existsSync(session.filePath)) {
      throw new AppError(410, 'Source file not found, please re-upload the video');
    }

    await deps.markAssetProcessing(id);
    if (processingJob) await deps.markJobProcessing(processingJob.id);
    await deps.enqueueTranscode(
      { videoAssetId: id, uploadSessionId, filePath: session.filePath },
      `retry-transcode-${id}-${now()}`,
    );
    return { stage: 'transcode' };
  };
}
