import { redisConnection, uploadSegmentsQueue, finalizeQueue } from './bull-config.js';
import { createPipelineWorkers } from './pipeline.js';
import { env } from '../config/env.js';
import { logger as rootLogger } from '../config/logger.js';
import { getVideoAssetById } from '../db/queries/assets.js';
import { webhookDispatcher } from '../webhooks/worker.js';

const logger = rootLogger.child({ name: 'queue-processors' });

/**
 * Send an asset event to the webhooks of the account that owns the asset.
 * Best effort: a delivery problem must never fail the pipeline step.
 */
async function emitAssetEvent(
  event: string,
  videoAssetId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    const asset = await getVideoAssetById(videoAssetId);
    if (!asset) return;
    await webhookDispatcher.dispatch(
      event,
      { video_asset_id: videoAssetId, ...data },
      asset.creatorAddress,
    );
  } catch (err) {
    logger.warn({ event, videoAssetId, err }, 'Webhook event not sent');
  }
}

// importing this module starts the pipeline workers, like the other workers
const workers = createPipelineWorkers({
  connection: redisConnection,
  outputRoot: env.TRANSCODE_OUTPUT_DIR,
  queues: { uploadSegments: uploadSegmentsQueue, finalize: finalizeQueue },
  emit: emitAssetEvent,
});

export const transcodeWorker = workers.transcode;
export const uploadSegmentsWorker = workers.uploadSegments;
export const finalizeWorker = workers.finalize;

/**
 * Gracefully shut down all workers.
 */
export async function closeWorkers(): Promise<void> {
  await workers.close();
}
