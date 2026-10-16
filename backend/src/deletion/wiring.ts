import type { Logger } from 'pino';
import { env } from '../config/env.js';
import { deleteObject, pruneSlabs } from '../storage/sia-client.js';
import { evictObjects } from '../storage/blob-manager.js';
import { unpinReleasedObjects } from '../storage/object-ledger.js';
import { invalidateObjectAccessTier } from '../delivery/access-control.js';
import {
  deleteVideoAsset,
  markObjectsUnpinned,
  transcodeOutputDispositions,
} from '../db/queries/assets.js';
import { listUploadFilePaths } from '../db/queries/uploads.js';
import { releaseAbandonedObjects } from '../db/queries/storage-records.js';
import { removeAssetSources } from '../upload/source-files.js';
import { removeAssetOutput, sweepOutputDirs } from '../queue/output-dirs.js';
import type { DeletionDeps } from './deleter.js';

/** The real Sia client, database and disk behind one asset deletion. */
export function assetDeletionDeps(logger: Logger): DeletionDeps {
  return {
    deleteObject,
    pruneSlabs,
    markUnpinned: markObjectsUnpinned,
    evictCache: (objectIds) => {
      evictObjects(objectIds);
      for (const id of objectIds) invalidateObjectAccessTier(id);
    },
    removeAsset: async (id) => {
      await deleteVideoAsset(id);
    },
    removeSources: (id) =>
      removeAssetSources(id, { listSourcePaths: listUploadFilePaths, log: logger }),
    removeOutput: (id) => removeAssetOutput(env.TRANSCODE_OUTPUT_DIR, id),
    logger,
  };
}

/** Release the pipeline objects no run will promote, then unpin everything marked for release. */
export async function releaseLeftoverObjects(): Promise<{
  released: number;
  unpinned: number;
  failed: number;
}> {
  const released = await releaseAbandonedObjects();
  const { unpinned, failed } = await unpinReleasedObjects();
  return { released, unpinned, failed };
}

export function sweepTranscodeOutput(logger: Logger): Promise<number> {
  return sweepOutputDirs({
    root: env.TRANSCODE_OUTPUT_DIR,
    dispositions: transcodeOutputDispositions,
    log: logger,
  });
}
