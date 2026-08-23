import { eq, and, desc, lt, sql, isNull, isNotNull, inArray, type SQL } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { videoAssets, artifacts, type VideoAsset, type NewVideoAsset } from '../schema.js';
import { decodeCursor, paginateRows } from '../../api/pagination.js';
import { collectAssetObjectIds } from '../../deletion/collect.js';

/**
 * Create a new video asset record.
 */
export async function createVideoAsset(data: NewVideoAsset): Promise<VideoAsset> {
  const [asset] = await db.insert(videoAssets).values(data).returning();
  return asset;
}

/**
 * Find a video asset by its primary key.
 *
 * `owner` scopes the lookup to a tenant's `creatorAddress`. API request
 * paths MUST pass it, otherwise any authenticated caller could read another
 * tenant's asset by guessing its UUID. Internal callers (queue workers, the
 * delivery gateway) intentionally omit it to operate across tenants.
 */
export async function getVideoAssetById(
  id: string,
  owner?: string,
): Promise<VideoAsset | undefined> {
  // Soft-deleted assets are invisible to every read: once deletion starts the
  // asset no longer exists as far as the API and the delivery gateway care.
  return db.query.videoAssets.findFirst({
    where: owner
      ? and(
          eq(videoAssets.id, id),
          eq(videoAssets.creatorAddress, owner),
          isNull(videoAssets.deletedAt),
        )
      : and(eq(videoAssets.id, id), isNull(videoAssets.deletedAt)),
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
  const { status, accessTier, creatorAddress, limit = 20, offset = 0, cursor } = opts ?? {};

  // Filters apply to both the data page and the total count. Soft-deleted
  // assets are excluded from every listing and from the total.
  const filters: SQL[] = [isNull(videoAssets.deletedAt)];
  if (status) filters.push(eq(videoAssets.status, status));
  if (accessTier) filters.push(eq(videoAssets.accessTier, accessTier));
  if (creatorAddress) filters.push(eq(videoAssets.creatorAddress, creatorAddress));
  const filterWhere = filters.length > 0 ? and(...filters) : undefined;

  // The cursor keyset narrows only the data page, never the count.
  const dataConditions: SQL[] = [...filters];
  const cursorKey = cursor ? decodeCursor(cursor) : null;
  if (cursorKey) {
    dataConditions.push(
      sql`(date_trunc('milliseconds', ${videoAssets.createdAt}), ${videoAssets.id}) < (${cursorKey.createdAt.toISOString()}::timestamptz, ${cursorKey.id}::uuid)`,
    );
  }
  const dataWhere = dataConditions.length > 0 ? and(...dataConditions) : undefined;

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
  owner?: string,
): Promise<VideoAsset | undefined> {
  const [updated] = await db
    .update(videoAssets)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      owner
        ? and(eq(videoAssets.id, id), eq(videoAssets.creatorAddress, owner))
        : eq(videoAssets.id, id),
    )
    .returning();
  return updated;
}

/**
 * Physically remove a video asset row (cascading to its renditions,
 * artifacts, jobs, and playback ids). Used by the deletion worker AFTER the
 * asset's Sia objects have been unpinned; API callers use
 * {@link softDeleteVideoAsset} instead.
 */
export async function deleteVideoAsset(
  id: string,
  owner?: string,
): Promise<VideoAsset | undefined> {
  const [deleted] = await db
    .delete(videoAssets)
    .where(
      owner
        ? and(eq(videoAssets.id, id), eq(videoAssets.creatorAddress, owner))
        : eq(videoAssets.id, id),
    )
    .returning();
  return deleted;
}

/**
 * Mark an asset for deletion: set `deletedAt` so it disappears from every
 * read, without touching its Sia objects yet. Only rows not already being
 * deleted match, so a repeated DELETE is a no-op (the route answers 404).
 * Returns the row when it transitioned, undefined otherwise.
 */
export async function softDeleteVideoAsset(
  id: string,
  owner?: string,
): Promise<VideoAsset | undefined> {
  const scope = owner
    ? and(
        eq(videoAssets.id, id),
        eq(videoAssets.creatorAddress, owner),
        isNull(videoAssets.deletedAt),
      )
    : and(eq(videoAssets.id, id), isNull(videoAssets.deletedAt));

  const [updated] = await db
    .update(videoAssets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(scope)
    .returning();
  return updated;
}

/**
 * Gather every Sia object id belonging to one asset, so the deletion worker
 * can unpin each. Reads the authoritative `artifacts` rows plus the
 * denormalized ids on the asset itself (covering assets that predate artifact
 * normalization). Deliberately does NOT filter on `deletedAt`: it must see
 * the just-soft-deleted row.
 */
export async function getAssetObjectIds(assetId: string): Promise<string[]> {
  const [artifactRows, asset] = await Promise.all([
    db
      .select({ objectId: artifacts.objectId })
      .from(artifacts)
      .where(eq(artifacts.videoAssetId, assetId)),
    db.query.videoAssets.findFirst({
      where: eq(videoAssets.id, assetId),
      columns: { manifestObjectId: true, thumbnailObjectIds: true, siaObjectIds: true },
    }),
  ]);

  return collectAssetObjectIds({
    artifactObjectIds: artifactRows.map((r) => r.objectId),
    manifestObjectId: asset?.manifestObjectId ?? null,
    thumbnailObjectIds: asset?.thumbnailObjectIds ?? [],
    siaObjectIds: (asset?.siaObjectIds ?? []) as string[],
  });
}

/**
 * Record that specific objects have been unpinned during a deletion: remove
 * their artifact rows and strip them from the asset's denormalized id fields.
 * This is what lets a retried or GC-re-driven deletion converge — the next
 * `getAssetObjectIds` returns only the objects that still need unpinning.
 */
export async function markObjectsUnpinned(assetId: string, unpinnedIds: string[]): Promise<void> {
  if (unpinnedIds.length === 0) return;
  const set = new Set(unpinnedIds);

  await db
    .delete(artifacts)
    .where(and(eq(artifacts.videoAssetId, assetId), inArray(artifacts.objectId, unpinnedIds)));

  const asset = await db.query.videoAssets.findFirst({
    where: eq(videoAssets.id, assetId),
    columns: { manifestObjectId: true, thumbnailObjectIds: true, siaObjectIds: true },
  });
  if (!asset) return;

  await db
    .update(videoAssets)
    .set({
      manifestObjectId:
        asset.manifestObjectId && set.has(asset.manifestObjectId) ? null : asset.manifestObjectId,
      thumbnailObjectIds: (asset.thumbnailObjectIds ?? []).filter((t) => !set.has(t)),
      siaObjectIds: ((asset.siaObjectIds ?? []) as string[]).filter((s) => !set.has(s)),
    })
    .where(eq(videoAssets.id, assetId));
}

/**
 * Find assets that have been soft-deleted for longer than `olderThanMs` and
 * still exist (their worker never finished). The GC sweep re-drives these.
 */
export async function listAssetsPendingDeletion(olderThanMs: number): Promise<{ id: string }[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  return db
    .select({ id: videoAssets.id })
    .from(videoAssets)
    .where(and(isNotNull(videoAssets.deletedAt), lt(videoAssets.deletedAt, cutoff)));
}
