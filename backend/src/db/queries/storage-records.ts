import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  renditions,
  artifacts,
  pendingObjects,
  processingJobs,
  videoAssets,
  type ProcessingJob,
} from '../schema.js';
import { resolveArtifactRows, type StorageRecords } from '../../storage/artifact-records.js';
import { collectAssetObjectIds } from '../../deletion/collect.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Persist the normalized rendition + artifact mapping for an asset.
 *
 * Idempotent: any prior rows for the asset are cleared first, so a
 * retried upload-segments/finalize run replaces the mapping cleanly
 * rather than duplicating it. Runs in a transaction so an asset never
 * has renditions without their artifacts (or vice versa). The pipeline goes
 * through {@link finalizeAssetStorage}, which also releases replaced objects.
 */
export async function persistStorageRecords(
  videoAssetId: string,
  records: StorageRecords,
): Promise<void> {
  await db.transaction((tx) => writeStorageRecords(tx, videoAssetId, records));
}

async function writeStorageRecords(
  tx: Tx,
  videoAssetId: string,
  records: StorageRecords,
): Promise<void> {
  // asset-level artifacts (master, thumbnails) have no rendition, so the
  // rendition cascade does not cover them
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
}

// Every object the pipeline pins is written to pending_objects just before
// its pin, as `uploading`. Finalize promotes the run's objects to artifacts
// and marks everything else of the asset `release`; a failed or cancelled
// upload marks its own `release`. Released objects are unpinned and then
// forgotten, and the deletion GC sweep retries the ones whose unpin failed,
// so no pinned object is ever left without a row that leads to it.

/** Record objects a run is about to pin. */
export async function recordUploadingObjects(
  videoAssetId: string,
  runKey: string,
  objectIds: string[],
): Promise<void> {
  if (objectIds.length === 0) return;
  await db
    .insert(pendingObjects)
    .values(objectIds.map((objectId) => ({ objectId, videoAssetId, runKey })))
    .onConflictDoNothing();
}

/** Mark objects to be unpinned. */
export async function markObjectsForRelease(objectIds: string[]): Promise<void> {
  if (objectIds.length === 0) return;
  await db
    .update(pendingObjects)
    .set({ state: 'release', updatedAt: new Date() })
    .where(inArray(pendingObjects.objectId, objectIds));
}

/**
 * Objects marked for release, oldest first, optionally of one asset. One an
 * artifact still names is left out: unpinning it would break a live asset,
 * so that row waits for whatever removes the artifact (a deletion).
 */
export async function listReleasedObjects(
  opts: { videoAssetId?: string; objectIds?: string[]; limit?: number } = {},
): Promise<string[]> {
  if (opts.objectIds?.length === 0) return [];
  const scope = [
    eq(pendingObjects.state, 'release'),
    sql`not exists (select 1 from ${artifacts} where ${artifacts.objectId} = ${pendingObjects.objectId})`,
  ];
  if (opts.videoAssetId) scope.push(eq(pendingObjects.videoAssetId, opts.videoAssetId));
  if (opts.objectIds) scope.push(inArray(pendingObjects.objectId, opts.objectIds));
  const rows = await db
    .select({ objectId: pendingObjects.objectId })
    .from(pendingObjects)
    .where(and(...scope))
    .orderBy(pendingObjects.updatedAt)
    .limit(opts.limit ?? 1000);
  return rows.map((r) => r.objectId);
}

/** Forget objects that are no longer pinned. */
export async function forgetPendingObjects(objectIds: string[]): Promise<void> {
  if (objectIds.length === 0) return;
  await db.delete(pendingObjects).where(inArray(pendingObjects.objectId, objectIds));
}

/**
 * Release uploading objects that no run can promote anymore: their asset is
 * gone, being deleted, or no longer processing (ready, or failed, where a
 * retry starts a new run with new objects). Returns how many were released.
 */
export async function releaseAbandonedObjects(): Promise<number> {
  const released = await db
    .update(pendingObjects)
    .set({ state: 'release', updatedAt: new Date() })
    .where(
      and(
        eq(pendingObjects.state, 'uploading'),
        sql`not exists (
          select 1 from ${videoAssets}
          where ${videoAssets.id} = ${pendingObjects.videoAssetId}
            and ${videoAssets.deletedAt} is null
            and ${videoAssets.status} = 'processing'
        )`,
      ),
    )
    .returning({ objectId: pendingObjects.objectId });
  return released.length;
}

export interface FinalizeStorageInput {
  records: StorageRecords;
  manifestObjectId: string;
  thumbnailObjectIds: string[];
  siaObjectIds: string[];
  durationMs: number;
  resolution: string;
  segmentCount: number;
  totalStorageBytes: number;
  processingJobId?: string;
}

export type FinalizeStorageOutcome =
  | { outcome: 'ready'; job: ProcessingJob | undefined }
  /** a finalize that already ran for these objects: nothing was written */
  | { outcome: 'already-ready' }
  /** deleted or being deleted: nothing was written */
  | { outcome: 'gone' }
  /** ready with other objects, or failed: nothing was written */
  | { outcome: 'not-processing'; status: string };

/**
 * Make a processing asset ready with the objects its run uploaded, in one
 * transaction: the storage records, the asset row, the processing job, and
 * the pending objects. The run's objects stop being pending; objects the
 * asset referenced before and no longer does, and every other pending object
 * of the asset (left by an earlier attempt or a duplicate execution), are
 * marked for release, so nothing is dropped from the records while pinned.
 *
 * The asset row is locked first, so a deletion either sees the finished
 * records (the soft delete waits for this transaction) or makes this see the
 * asset as gone.
 */
export async function finalizeAssetStorage(
  videoAssetId: string,
  input: FinalizeStorageInput,
): Promise<FinalizeStorageOutcome> {
  return db.transaction(async (tx) => {
    const [asset] = await tx
      .select({
        status: videoAssets.status,
        manifestObjectId: videoAssets.manifestObjectId,
        thumbnailObjectIds: videoAssets.thumbnailObjectIds,
        siaObjectIds: videoAssets.siaObjectIds,
      })
      .from(videoAssets)
      .where(and(eq(videoAssets.id, videoAssetId), isNull(videoAssets.deletedAt)))
      .for('update');
    if (!asset) return { outcome: 'gone' };
    if (asset.status === 'ready' && asset.manifestObjectId === input.manifestObjectId) {
      return { outcome: 'already-ready' };
    }
    if (asset.status !== 'processing') return { outcome: 'not-processing', status: asset.status };

    const previousArtifacts = await tx
      .select({ objectId: artifacts.objectId })
      .from(artifacts)
      .where(eq(artifacts.videoAssetId, videoAssetId));
    const previous = collectAssetObjectIds({
      artifactObjectIds: previousArtifacts.map((r) => r.objectId),
      manifestObjectId: asset.manifestObjectId,
      thumbnailObjectIds: asset.thumbnailObjectIds,
      siaObjectIds: (asset.siaObjectIds ?? []) as string[],
    });
    const current = new Set(
      collectAssetObjectIds({
        artifactObjectIds: input.records.artifacts.map((a) => a.objectId),
        manifestObjectId: input.manifestObjectId,
        thumbnailObjectIds: input.thumbnailObjectIds,
        siaObjectIds: input.siaObjectIds,
      }),
    );

    await writeStorageRecords(tx, videoAssetId, input.records);
    await tx
      .update(videoAssets)
      .set({
        manifestObjectId: input.manifestObjectId,
        thumbnailObjectIds: input.thumbnailObjectIds,
        siaObjectIds: input.siaObjectIds,
        durationMs: input.durationMs,
        resolution: input.resolution,
        segmentCount: input.segmentCount,
        totalStorageBytes: input.totalStorageBytes,
        status: 'ready',
        updatedAt: new Date(),
      })
      .where(eq(videoAssets.id, videoAssetId));

    await tx.delete(pendingObjects).where(inArray(pendingObjects.objectId, [...current]));
    const replaced = previous.filter((id) => !current.has(id));
    if (replaced.length > 0) {
      await tx
        .insert(pendingObjects)
        .values(
          replaced.map((objectId) => ({
            objectId,
            videoAssetId,
            runKey: 'replaced',
            state: 'release' as const,
          })),
        )
        .onConflictDoUpdate({
          target: pendingObjects.objectId,
          set: { state: 'release', updatedAt: new Date() },
        });
    }
    await tx
      .update(pendingObjects)
      .set({ state: 'release', updatedAt: new Date() })
      .where(
        and(eq(pendingObjects.videoAssetId, videoAssetId), eq(pendingObjects.state, 'uploading')),
      );

    let job: ProcessingJob | undefined;
    if (input.processingJobId) {
      const now = new Date();
      [job] = await tx
        .update(processingJobs)
        .set({
          status: 'completed',
          progressPercent: 100,
          errorMessage: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(processingJobs.id, input.processingJobId))
        .returning();
    }
    return { outcome: 'ready', job };
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

/**
 * The asset's renditions, tallest first, as the pipeline recorded them. One
 * whose master playlist line gave no resolution has no height; postgres
 * sorts nulls first in a descending order, so it is moved last.
 */
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
    .orderBy(
      sql`${renditions.height} desc nulls last`,
      sql`${renditions.videoBitrateKbps} desc nulls last`,
    );
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
