import { logger } from '../config/logger.js';
import { deleteObject } from './sia-client.js';
import { evictObjects } from './blob-manager.js';
import { invalidateObjectAccessTier } from '../delivery/access-control.js';
import {
  forgetPendingObjects,
  listReleasedObjects,
  markObjectsForRelease,
  recordUploadingObjects,
} from '../db/queries/storage-records.js';

/**
 * Where an upload writes down what it pins: `record` before the pin, and
 * `release` for objects it pinned and no longer wants.
 */
export interface ObjectLedger {
  record(objectIds: string[]): Promise<void>;
  release(objectIds: string[]): Promise<void>;
}

/** The ledger of one processing run of one asset, kept in pending_objects. */
export function runLedger(videoAssetId: string, runKey: string): ObjectLedger {
  return {
    record: (objectIds) => recordUploadingObjects(videoAssetId, runKey, objectIds),
    release: (objectIds) => releaseObjects(objectIds),
  };
}

async function unpinAndForget(objectIds: string[]): Promise<{ unpinned: number; failed: number }> {
  let unpinned = 0;
  let failed = 0;
  for (const objectId of objectIds) {
    try {
      await deleteObject(objectId);
    } catch (err) {
      // the row stays, so the deletion gc sweep retries it
      failed++;
      logger.warn({ objectId, err }, 'Could not unpin a released object; it will be retried');
      continue;
    }
    unpinned++;
    evictObjects([objectId]);
    invalidateObjectAccessTier(objectId);
    try {
      await forgetPendingObjects([objectId]);
    } catch (err) {
      // a later sweep unpins it again, which the indexer answers with not found
      logger.warn({ objectId, err }, 'Could not forget an unpinned object');
    }
  }
  return { unpinned, failed };
}

/**
 * Mark objects for release and unpin them now. When the database cannot be
 * written they are still unpinned: their rows stay `uploading` and the sweep
 * forgets them once their asset stops processing.
 */
export async function releaseObjects(objectIds: string[]): Promise<void> {
  if (objectIds.length === 0) return;
  let toUnpin = objectIds;
  try {
    await markObjectsForRelease(objectIds);
    toUnpin = await listReleasedObjects({ objectIds });
  } catch (err) {
    logger.warn({ err, count: objectIds.length }, 'Could not mark objects for release');
  }
  await unpinAndForget(toUnpin);
}

/**
 * Unpin every object marked for release, optionally only one asset's. The
 * deletion gc sweep calls this for all of them, finalize for its asset.
 */
export async function unpinReleasedObjects(
  opts: { videoAssetId?: string } = {},
): Promise<{ unpinned: number; failed: number }> {
  return unpinAndForget(await listReleasedObjects(opts));
}
