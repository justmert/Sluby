import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  videoAssets,
  type VideoAsset,
  type NewVideoAsset,
} from '../schema.js';
import { decodeCursor, paginateRows } from '../../api/pagination.js';

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
 *
 * Supports two paging styles over the same stable total order
 * (`createdAt` then `id`, both descending):
 *  - **Cursor (keyset)**: pass `cursor`; rows strictly after that key are
 *    returned and a `nextCursor` is issued. Correct under concurrent
 *    inserts/deletes, and the documented mechanism.
 *  - **Offset**: pass `offset` (page-based); kept so existing callers and
 *    the Studio keep working.
 *
 * `total` is always the full filtered count, independent of the cursor.
 * Timestamps are compared truncated to milliseconds so the JS-side cursor
 * (millisecond precision) and the SQL ordering agree exactly.
 */
export async function listVideoAssets(opts?: {
  status?: VideoAsset['status'];
  accessTier?: VideoAsset['accessTier'];
  creatorAddress?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}): Promise<{
  data: VideoAsset[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const { status, accessTier, creatorAddress, limit = 20, offset = 0, cursor } =
    opts ?? {};

  // Filters apply to both the data page and the total count.
  const filters: SQL[] = [];
  if (status) filters.push(eq(videoAssets.status, status));
  if (accessTier) filters.push(eq(videoAssets.accessTier, accessTier));
  if (creatorAddress)
    filters.push(eq(videoAssets.creatorAddress, creatorAddress));
  const filterWhere = filters.length > 0 ? and(...filters) : undefined;

  // The cursor keyset narrows only the data page, never the count.
  const dataConditions: SQL[] = [...filters];
  const cursorKey = cursor ? decodeCursor(cursor) : null;
  if (cursorKey) {
    dataConditions.push(
      sql`(date_trunc('milliseconds', ${videoAssets.createdAt}), ${videoAssets.id}) < (${cursorKey.createdAt.toISOString()}::timestamptz, ${cursorKey.id}::uuid)`,
    );
  }
  const dataWhere =
    dataConditions.length > 0 ? and(...dataConditions) : undefined;

  const orderCreatedAt = sql`date_trunc('milliseconds', ${videoAssets.createdAt})`;

  const [rows, countResult] = await Promise.all([
    db.query.videoAssets.findMany({
      where: dataWhere,
      // Over-fetch by one so paginateRows can detect a next page.
      limit: limit + 1,
      // Offset only makes sense without a cursor.
      offset: cursorKey ? 0 : offset,
      orderBy: [desc(orderCreatedAt), desc(videoAssets.id)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(videoAssets)
      .where(filterWhere),
  ]);

  const page = paginateRows(rows, limit);
  return {
    data: page.data,
    total: countResult[0]?.count ?? 0,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
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
