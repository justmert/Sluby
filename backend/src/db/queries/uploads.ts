import { and, eq, ne } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { uploadSessions, type UploadSession, type NewUploadSession } from '../schema.js';

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
