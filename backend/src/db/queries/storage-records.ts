import { desc, eq } from 'drizzle-orm';
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

export interface RenditionRecord {
  name: string;
  width: number | null;
  height: number | null;
  videoBitrateKbps: number | null;
  segmentCount: number;
  byteSize: number;
  dataObjectId: string;
  playlistObjectId: string;
}

export interface ArtifactRecord {
  objectId: string;
  /** null for an object stored before roles were recorded. */
  role: 'master_manifest' | 'variant_playlist' | 'rendition_data' | 'thumbnail' | null;
  renditionName: string | null;
  byteSize: number;
}

/** The asset's renditions, tallest first, as the pipeline recorded them. */
export async function getRenditions(videoAssetId: string): Promise<RenditionRecord[]> {
  const rows = await db
    .select({
      name: renditions.name,
      width: renditions.width,
      height: renditions.height,
      videoBitrateKbps: renditions.videoBitrateKbps,
      segmentCount: renditions.segmentCount,
      byteSize: renditions.byteSize,
      dataObjectId: renditions.dataObjectId,
      playlistObjectId: renditions.playlistObjectId,
    })
    .from(renditions)
    .where(eq(renditions.videoAssetId, videoAssetId))
    .orderBy(desc(renditions.height), desc(renditions.videoBitrateKbps));
  return rows;
}

/** Every stored object of an asset with its role and rendition. */
export async function getArtifacts(videoAssetId: string): Promise<ArtifactRecord[]> {
  return db
    .select({
      objectId: artifacts.objectId,
      role: artifacts.role,
      renditionName: renditions.name,
      byteSize: artifacts.byteSize,
    })
    .from(artifacts)
    .leftJoin(renditions, eq(artifacts.renditionId, renditions.id))
    .where(eq(artifacts.videoAssetId, videoAssetId));
}
