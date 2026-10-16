import { and, eq, inArray, ne } from 'drizzle-orm';
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
