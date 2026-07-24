import { eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  uploadSessions,
  type UploadSession,
  type NewUploadSession,
} from '../schema.js';

/**
 * Create a new upload session record.
 */
export async function createUploadSession(
  data: NewUploadSession,
): Promise<UploadSession> {
  const [session] = await db
    .insert(uploadSessions)
    .values(data)
    .returning();
  return session;
}

/**
 * Find an upload session by its primary key.
 */
export async function getUploadSessionById(
  id: string,
): Promise<UploadSession | undefined> {
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
