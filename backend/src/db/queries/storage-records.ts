import { eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { renditions, artifacts } from '../schema.js';
import { resolveArtifactRows, type StorageRecords } from '../../storage/artifact-records.js';

/**
 * Persist the normalized rendition + artifact mapping for an asset.
 *
 * Idempotent: any prior rows for the asset are cleared first, so a
 * retried upload-segments/finalize run replaces the mapping cleanly
 * rather than duplicating it. Runs in a transaction so an asset never
 * has renditions without their artifacts (or vice versa).
 */
export async function persistStorageRecords(
  videoAssetId: string,
  records: StorageRecords,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Clear prior rows (retries re-run the upload stage). Delete artifacts
    // first — asset-level artifacts (master/thumbnail) have a null
    // rendition FK and so are not covered by the rendition cascade.
    await tx.delete(artifacts).where(eq(artifacts.videoAssetId, videoAssetId));
    await tx.delete(renditions).where(eq(renditions.videoAssetId, videoAssetId));

    let insertedRenditions: Array<{ id: string; name: string }> = [];
    if (records.renditions.length > 0) {
      insertedRenditions = await tx
        .insert(renditions)
        .values(
          records.renditions.map((r) => ({
            videoAssetId,
            name: r.name,
            width: r.width,
            height: r.height,
            videoBitrateKbps: r.videoBitrateKbps,
            segmentCount: r.segmentCount,
            byteSize: r.byteSize,
            dataObjectId: r.dataObjectId,
            playlistObjectId: r.playlistObjectId,
          })),
        )
        .returning({ id: renditions.id, name: renditions.name });
    }

    const rows = resolveArtifactRows(videoAssetId, insertedRenditions, records.artifacts);
    if (rows.length > 0) {
      await tx.insert(artifacts).values(rows);
    }
  });
}
