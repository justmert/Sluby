import { existsSync } from 'node:fs';
import { AppError } from '../api/middleware/error-handler.js';
import type { TranscodeJobData, UploadSegmentsJobData } from './bull-config.js';
import type { CompletedOutput } from './output-dirs.js';

/**
 * Retry of a failed asset, with the database and queues injected so the
 * stage decision is testable without them. `app.ts` wires the real ones.
 */
export interface RetryAssetDeps {
  /** The asset if it exists, is owned by `owner` and is not being deleted. */
  getAsset: (id: string, owner?: string) => Promise<{ id: string; status: string } | undefined>;
  /** The asset's latest processing job, if it has one. */
  getProcessingJob: (videoAssetId: string) => Promise<{ id: string } | undefined>;
  createProcessingJob: (videoAssetId: string, uploadSessionId: string) => Promise<{ id: string }>;
  /** The finished upload the asset was made from. */
  getUploadSession: (videoAssetId: string) => Promise<{ id: string; filePath: string } | undefined>;
  /** The newest transcode of the asset that finished, see output-dirs.ts. */
  findCompletedOutput: (videoAssetId: string) => Promise<CompletedOutput | null>;
  /** Failed to processing in one step; false when another caller got there first. */
  claimFailedAsset: (id: string, owner?: string) => Promise<boolean>;
  /** Back to failed when the retry could not be queued. */
  releaseClaim: (id: string) => Promise<void>;
  /** A new run of the processing job: error cleared, retry counted. */
  restartJob: (jobId: string) => Promise<void>;
  enqueueUploadSegments: (data: UploadSegmentsJobData, jobId: string) => Promise<void>;
  enqueueTranscode: (data: TranscodeJobData, jobId: string) => Promise<void>;
  sourceExists?: (filePath: string) => boolean;
  now?: () => number;
}

export type RetryStage = 'upload-segments' | 'transcode';

/**
 * Build the `retryAsset` handler behind POST /assets/:id/retry. A transcode
 * that finished (its run directory holds the completion marker) is not redone:
 * the retry resumes at the Sia upload. Otherwise the source upload is
 * transcoded again, which needs the uploaded file to still be on disk.
 */
export function buildRetryAsset(deps: RetryAssetDeps) {
  const now = deps.now ?? Date.now;
  const sourceExists = deps.sourceExists ?? existsSync;

  return async (id: string, owner?: string): Promise<{ stage: RetryStage }> => {
    const asset = await deps.getAsset(id, owner);
    if (!asset) throw new AppError(404, 'Video asset not found');
    if (asset.status !== 'failed') throw new AppError(400, 'Asset is not in failed state');

    const [session, completed] = await Promise.all([
      deps.getUploadSession(id),
      deps.findCompletedOutput(id),
    ]);
    if (!completed && (!session?.filePath || !sourceExists(session.filePath))) {
      throw new AppError(410, 'Source file not found, please re-upload the video');
    }

    // two retries at once: only one moves the asset, the other sees it processing
    if (!(await deps.claimFailedAsset(id, owner))) {
      throw new AppError(400, 'Asset is not in failed state');
    }

    // a fresh run, so the stages after this one get job ids the failed
    // attempt never used
    const runId = `retry-${now()}`;
    try {
      const job = await deps.getProcessingJob(id);
      if (job) await deps.restartJob(job.id);
      else if (session) await deps.createProcessingJob(id, session.id);

      if (completed) {
        await deps.enqueueUploadSegments(
          {
            videoAssetId: id,
            ...(session ? { uploadSessionId: session.id } : {}),
            outputDir: completed.outputDir,
            thumbnailPaths: completed.thumbnailPaths,
            durationMs: completed.marker.durationMs,
            resolution: completed.marker.resolution,
            startsRun: true,
            runId,
          },
          `upload-${id}-${runId}`,
        );
        return { stage: 'upload-segments' };
      }

      await deps.enqueueTranscode(
        { videoAssetId: id, uploadSessionId: session!.id, filePath: session!.filePath, runId },
        `transcode-${id}-${runId}`,
      );
      return { stage: 'transcode' };
    } catch (err) {
      // nothing will run, so the asset must stay retryable
      await deps.releaseClaim(id);
      throw err;
    }
  };
}
