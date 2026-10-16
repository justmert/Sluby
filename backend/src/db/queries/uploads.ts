import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  uploadSessions,
  videoAssets,
  type UploadSession,
  type NewUploadSession,
} from '../schema.js';

/**
 * Create a new upload session record.
 */
export async function createUploadSession(data: NewUploadSession): Promise<UploadSession> {
  const [session] = await db.insert(uploadSessions).values(data).returning();
  return session;
}

/**
 * Find an upload session by its primary key.
 */
export async function getUploadSessionById(id: string): Promise<UploadSession | undefined> {
  return db.query.uploadSessions.findFirst({
    where: eq(uploadSessions.id, id),
  });
}

/**
 * The finished upload an asset was made from, the newest when there are
 * several. A retry reads its source from it.
 */
export async function getCompletedUploadSessionForAsset(
  videoAssetId: string,
): Promise<UploadSession | undefined> {
  return db.query.uploadSessions.findFirst({
    where: and(
      eq(uploadSessions.videoAssetId, videoAssetId),
      eq(uploadSessions.status, 'completed'),
    ),
    orderBy: [desc(uploadSessions.createdAt)],
  });
}

/**
 * Generic partial update for an upload session.
 */
export async function updateUploadSession(
  id: string,
  data: Partial<
    Pick<
      UploadSession,
      | 'videoAssetId'
      | 'uploadUrl'
      | 'filePath'
      | 'fileSize'
      | 'uploadedBytes'
      | 'sha256Hash'
      | 'status'
      | 'metadata'
      | 'expiresAt'
    >
  >,
): Promise<UploadSession | undefined> {
  const [updated] = await db
    .update(uploadSessions)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(uploadSessions.id, id))
    .returning();
  return updated;
}

/**
 * The upload file paths of an asset's sessions, for removing them when the
 * asset is deleted. Cancelled sessions are left out: whoever cancelled one
 * removes its files (the tus DELETE handler or the REST cancel route), and
 * racing a tus DELETE to them would make it answer 404. Sessions created
 * before the path was recorded at creation hold '' until they complete.
 */
export async function listUploadFilePaths(videoAssetId: string): Promise<string[]> {
  const rows = await db
    .select({ filePath: uploadSessions.filePath })
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.videoAssetId, videoAssetId), ne(uploadSessions.status, 'cancelled')),
    );
  return rows.map((r) => r.filePath).filter(Boolean);
}

/**
 * Uploads still `uploading` past their expiry: nothing will finish them. Each
 * comes with its asset's state, so the caller only discards an asset that
 * never got past the upload (an asset whose upload finished but failed later
 * keeps its source for a retry).
 */
export async function listExpiredUploadingSessions(now: Date): Promise<
  Array<{
    id: string;
    filePath: string;
    videoAssetId: string | null;
    assetStatus: VideoAssetStatus | null;
    assetDeleted: boolean;
  }>
> {
  const rows = await db
    .select({
      id: uploadSessions.id,
      filePath: uploadSessions.filePath,
      videoAssetId: uploadSessions.videoAssetId,
      assetStatus: videoAssets.status,
      deletedAt: videoAssets.deletedAt,
    })
    .from(uploadSessions)
    .leftJoin(videoAssets, eq(videoAssets.id, uploadSessions.videoAssetId))
    .where(and(eq(uploadSessions.status, 'uploading'), lt(uploadSessions.expiresAt, now)));
  return rows.map((r) => ({
    id: r.id,
    filePath: r.filePath,
    videoAssetId: r.videoAssetId,
    assetStatus: r.assetStatus,
    assetDeleted: r.deletedAt !== null,
  }));
}

type VideoAssetStatus = (typeof videoAssets.status.enumValues)[number];

/** What a source upload's asset is doing, see sourceFileStates. */
export type SourceFileState = 'ready' | 'gone' | 'in-use' | 'cancelled';

// keeps each IN list well under postgres's bind parameter limit
const PATH_BATCH = 1000;

/**
 * For each source file path that an upload session records, whether its
 * asset still needs it: 'ready' and 'gone' (the asset was deleted) mean the
 * source can go, 'in-use' (uploading, processing or failed, kept for a
 * retry) means it stays, and 'cancelled' sessions are left to whoever
 * cancelled them. Paths no session records are absent from the map.
 */
export async function sourceFileStates(paths: string[]): Promise<Map<string, SourceFileState>> {
  const states = new Map<string, SourceFileState>();
  for (let i = 0; i < paths.length; i += PATH_BATCH) {
    const rows = await db
      .select({
        filePath: uploadSessions.filePath,
        sessionStatus: uploadSessions.status,
        assetId: videoAssets.id,
        assetStatus: videoAssets.status,
        deletedAt: videoAssets.deletedAt,
      })
      .from(uploadSessions)
      .leftJoin(videoAssets, eq(videoAssets.id, uploadSessions.videoAssetId))
      .where(inArray(uploadSessions.filePath, paths.slice(i, i + PATH_BATCH)));
    for (const r of rows) {
      const state: SourceFileState =
        r.sessionStatus === 'cancelled'
          ? 'cancelled'
          : !r.assetId || r.deletedAt
            ? 'gone'
            : r.assetStatus === 'ready'
              ? 'ready'
              : 'in-use';
      // a path shared by several sessions is only removable when none of
      // them still needs it
      const prev = states.get(r.filePath);
      states.set(r.filePath, prev === 'in-use' || state === 'in-use' ? 'in-use' : (prev ?? state));
    }
  }
  return states;
}

/**
 * Delete the upload sessions of hard-deleted assets whose source file is no
 * longer in UPLOAD_DIR: `onDisk` is every source path the sweep still found
 * there. A session whose file is still there stays, since it is how the sweep
 * knows that file can go. Returns how many were deleted.
 */
export async function deleteDetachedUploadSessions(onDisk: string[]): Promise<number> {
  // one jsonb parameter, as the directory can hold more files than postgres
  // takes bind parameters
  const rows = await db
    .delete(uploadSessions)
    .where(
      and(
        isNull(uploadSessions.videoAssetId),
        sql`${uploadSessions.filePath} not in (select jsonb_array_elements_text(${JSON.stringify(onDisk)}::jsonb))`,
      ),
    )
    .returning({ id: uploadSessions.id });
  return rows.length;
}
