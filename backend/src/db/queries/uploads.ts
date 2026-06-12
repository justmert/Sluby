import { eq, and, lt, desc } from 'drizzle-orm';
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
 * Find an upload session by associated video asset ID.
 */
export async function getUploadSessionByVideoAssetId(
  videoAssetId: string,
): Promise<UploadSession | undefined> {
  return db.query.uploadSessions.findFirst({
    where: eq(uploadSessions.videoAssetId, videoAssetId),
  });
}

/**
 * List upload sessions, optionally filtered by status.
 * Results are ordered by creation time descending.
 */
export async function listUploadSessions(opts?: {
  status?: UploadSession['status'];
  limit?: number;
  offset?: number;
}): Promise<UploadSession[]> {
  const { status, limit = 50, offset = 0 } = opts ?? {};

  const conditions = status
    ? eq(uploadSessions.status, status)
    : undefined;

  return db.query.uploadSessions.findMany({
    where: conditions,
    limit,
    offset,
    orderBy: [desc(uploadSessions.createdAt)],
  });
}

/**
 * Update the byte-progress of an upload session.
 */
export async function updateUploadProgress(
  id: string,
  uploadedBytes: number,
): Promise<UploadSession | undefined> {
  const [updated] = await db
    .update(uploadSessions)
    .set({
      uploadedBytes,
      updatedAt: new Date(),
    })
    .where(eq(uploadSessions.id, id))
    .returning();
  return updated;
}

/**
 * Mark an upload session as completed with the final file hash.
 */
export async function completeUploadSession(
  id: string,
  data: { sha256Hash: string; filePath: string },
): Promise<UploadSession | undefined> {
  const [updated] = await db
    .update(uploadSessions)
    .set({
      status: 'completed',
      sha256Hash: data.sha256Hash,
      filePath: data.filePath,
      updatedAt: new Date(),
    })
    .where(eq(uploadSessions.id, id))
    .returning();
  return updated;
}

/**
 * Mark an upload session as cancelled.
 */
export async function cancelUploadSession(
  id: string,
): Promise<UploadSession | undefined> {
  const [updated] = await db
    .update(uploadSessions)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(uploadSessions.id, id))
    .returning();
  return updated;
}

/**
 * Mark an upload session as failed with an optional error in metadata.
 */
export async function failUploadSession(
  id: string,
  errorMessage?: string,
): Promise<UploadSession | undefined> {
  const [updated] = await db
    .update(uploadSessions)
    .set({
      status: 'failed',
      metadata: errorMessage ? { error: errorMessage } : undefined,
      updatedAt: new Date(),
    })
    .where(eq(uploadSessions.id, id))
    .returning();
  return updated;
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
 * Delete an upload session by ID.
 */
export async function deleteUploadSession(
  id: string,
): Promise<UploadSession | undefined> {
  const [deleted] = await db
    .delete(uploadSessions)
    .where(eq(uploadSessions.id, id))
    .returning();
  return deleted;
}

/**
 * Remove expired upload sessions (status still "uploading" past expiresAt).
 * Returns the number of sessions cleaned up.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = new Date();
  const deleted = await db
    .delete(uploadSessions)
    .where(
      and(
        eq(uploadSessions.status, 'uploading'),
        lt(uploadSessions.expiresAt, now),
      ),
    )
    .returning();
  return deleted.length;
}
