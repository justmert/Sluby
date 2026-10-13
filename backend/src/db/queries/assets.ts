import {
  eq,
  and,
  or,
  asc,
  desc,
  lt,
  sql,
  ilike,
  isNull,
  isNotNull,
  inArray,
  type SQL,
} from 'drizzle-orm';
import { db } from '../../config/database.js';
import { videoAssets, artifacts, type VideoAsset, type NewVideoAsset } from '../schema.js';
import { decodeCursor, paginateRows } from '../../api/pagination.js';
import { collectAssetObjectIds } from '../../deletion/collect.js';
import { isDefaultAssetOrder, type AssetSortField, type SortOrder } from '../../api/asset-sort.js';

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

export interface AssetListOptions {
  status?: VideoAsset['status'];
  accessTier?: VideoAsset['accessTier'];
  creatorAddress?: string;
  /** Case-insensitive match on title or description, or an exact asset id. */
  search?: string;
  sort?: AssetSortField;
  order?: SortOrder;
  limit?: number;
  offset?: number;
  cursor?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escape LIKE wildcards so a search for "50%" matches the literal text. */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The WHERE and ORDER BY for an asset listing, kept pure so the generated SQL
 * can be checked without a database.
 *
 * Every order ends in `id` so pages are stable when the sort key ties.
 * Timestamps compare truncated to milliseconds so the JS-side cursor
 * (millisecond precision) and the SQL ordering agree exactly.
 */
export function assetListQuery(opts: AssetListOptions) {
  const { status, accessTier, creatorAddress, search, cursor } = opts;
  const sort = opts.sort ?? 'created_at';
  const order = opts.order ?? 'desc';

  // Filters apply to both the data page and the total count. Soft-deleted
  // assets are excluded from every listing and from the total.
  const filters: SQL[] = [isNull(videoAssets.deletedAt)];
  if (status) filters.push(eq(videoAssets.status, status));
  if (accessTier) filters.push(eq(videoAssets.accessTier, accessTier));
  if (creatorAddress) filters.push(eq(videoAssets.creatorAddress, creatorAddress));
  const term = search?.trim();
  if (term) {
    const pattern = likeContains(term);
    const matches = [ilike(videoAssets.title, pattern), ilike(videoAssets.description, pattern)];
    if (UUID_RE.test(term)) matches.push(eq(videoAssets.id, term));
    filters.push(or(...matches)!);
  }

  // The cursor keyset narrows only the data page, never the count, and only
  // exists for the default newest-first order.
  const dataConditions: SQL[] = [...filters];
  const cursorKey = cursor && isDefaultAssetOrder(sort, order) ? decodeCursor(cursor) : null;
  if (cursorKey) {
    dataConditions.push(
      sql`(date_trunc('milliseconds', ${videoAssets.createdAt}), ${videoAssets.id}) < (${cursorKey.createdAt.toISOString()}::timestamptz, ${cursorKey.id}::uuid)`,
    );
  }

  const key: Record<AssetSortField, SQL> = {
    created_at: sql`date_trunc('milliseconds', ${videoAssets.createdAt})`,
    title: sql`lower(${videoAssets.title})`,
    duration: sql`${videoAssets.durationMs}`,
    size: sql`${videoAssets.totalStorageBytes}`,
  };
  const dir = order === 'asc' ? asc : desc;

  return {
    filterWhere: and(...filters),
    dataWhere: and(...dataConditions),
    orderBy: [dir(key[sort]), dir(videoAssets.id)],
    cursorKey,
  };
}

/**
 * Paginated listing of video assets with filters, search and sorting.
 *
 * Two paging styles share the result shape:
 *  - **Cursor (keyset)**: pass `cursor`; rows strictly after that key are
 *    returned and a `nextCursor` is issued. Only for the default
 *    newest-first order, where it is correct under concurrent writes.
 *  - **Offset**: pass `offset` (page-based), for every order.
 *
 * `total` is always the full filtered count, independent of the cursor.
 */
export async function listVideoAssets(opts?: AssetListOptions): Promise<{
  data: VideoAsset[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const { limit = 20, offset = 0 } = opts ?? {};
  const { filterWhere, dataWhere, orderBy, cursorKey } = assetListQuery(opts ?? {});

  const [rows, countResult] = await Promise.all([
    db.query.videoAssets.findMany({
      where: dataWhere,
      // Over-fetch by one so paginateRows can detect a next page.
      limit: limit + 1,
      // Offset only makes sense without a cursor.
      offset: cursorKey ? 0 : offset,
      orderBy,
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
    // a cursor encodes the newest-first keyset, so other orders page by offset
    nextCursor: isDefaultAssetOrder(opts?.sort, opts?.order) ? page.nextCursor : null,
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
