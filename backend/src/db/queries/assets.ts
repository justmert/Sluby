import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  videoAssets,
  type VideoAsset,
  type NewVideoAsset,
} from '../schema.js';

/**
 * Create a new video asset record.
 */
export async function createVideoAsset(
  data: NewVideoAsset,
): Promise<VideoAsset> {
  const [asset] = await db.insert(videoAssets).values(data).returning();
  return asset;
}

/**
 * Find a video asset by its primary key.
 */
export async function getVideoAssetById(
  id: string,
): Promise<VideoAsset | undefined> {
  return db.query.videoAssets.findFirst({
    where: eq(videoAssets.id, id),
  });
}

/**
 * Paginated listing of video assets with optional filters.
 * Returns both the data page and total count.
 */
export async function listVideoAssets(opts?: {
  status?: VideoAsset['status'];
  accessTier?: VideoAsset['accessTier'];
  creatorAddress?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: VideoAsset[]; total: number }> {
  const { status, accessTier, creatorAddress, limit = 20, offset = 0 } =
    opts ?? {};

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(videoAssets.status, status));
  if (accessTier) conditions.push(eq(videoAssets.accessTier, accessTier));
  if (creatorAddress)
    conditions.push(eq(videoAssets.creatorAddress, creatorAddress));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    db.query.videoAssets.findMany({
      where,
      limit,
      offset,
      orderBy: [desc(videoAssets.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(videoAssets)
      .where(where),
  ]);

  return {
    data,
    total: countResult[0]?.count ?? 0,
  };
}

/**
 * Update a video asset with partial data.
 */
export async function updateVideoAsset(
  id: string,
  data: Partial<
    Pick<
      VideoAsset,
      | 'manifestObjectId'
      | 'title'
      | 'description'
      | 'durationMs'
      | 'resolution'
      | 'status'
      | 'accessTier'
      | 'thumbnailObjectIds'
      | 'segmentCount'
      | 'totalStorageBytes'
      | 'siaObjectIds'
    >
  >,
): Promise<VideoAsset | undefined> {
  const [updated] = await db
    .update(videoAssets)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(videoAssets.id, id))
    .returning();
  return updated;
}

/**
 * Update the processing status of a video asset.
 */
export async function updateVideoAssetStatus(
  id: string,
  status: VideoAsset['status'],
): Promise<VideoAsset | undefined> {
  const [updated] = await db
    .update(videoAssets)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(videoAssets.id, id))
    .returning();
  return updated;
}

/**
 * Delete a video asset by ID.
 */
export async function deleteVideoAsset(
  id: string,
): Promise<VideoAsset | undefined> {
  const [deleted] = await db
    .delete(videoAssets)
    .where(eq(videoAssets.id, id))
    .returning();
  return deleted;
}

/**
 * Count video assets grouped by status.
 * Useful for dashboard metrics.
 */
export async function countVideoAssetsByStatus(): Promise<
  Record<string, number>
> {
  const rows = await db
    .select({
      status: videoAssets.status,
      count: sql<number>`count(*)::int`,
    })
    .from(videoAssets)
    .groupBy(videoAssets.status);

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.status] = row.count;
  }
  return result;
}
