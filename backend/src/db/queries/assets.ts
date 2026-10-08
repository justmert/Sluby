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
import {
  videoAssets,
  artifacts,
  pendingObjects,
  uploadSessions,
  type VideoAsset,
  type NewVideoAsset,
} from '../schema.js';
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
    where:
      owner !== undefined
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
 * created_at is stored at millisecond precision, the precision of the cursor,
 * so the newest-first order and the keyset compare the plain column and an
 * index serves them.
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
  if (creatorAddress !== undefined) {
    filters.push(eq(videoAssets.creatorAddress, creatorAddress));
  }
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
      sql`(${videoAssets.createdAt}, ${videoAssets.id}) < (${cursorKey.createdAt.toISOString()}::timestamptz, ${cursorKey.id}::uuid)`,
    );
  }

  const key: Record<AssetSortField, SQL> = {
    created_at: sql`${videoAssets.createdAt}`,
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
 * Update a video asset with partial data. For the pipeline workers, which
 * act on any asset; API edits go through {@link updateAssetMetadata}.
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
      owner !== undefined
        ? and(eq(videoAssets.id, id), eq(videoAssets.creatorAddress, owner))
        : eq(videoAssets.id, id),
    )
    .returning();
  return updated;
}

/**
 * The API's metadata edit. Unlike {@link updateVideoAsset}, which the
 * pipeline workers use, an asset that is being deleted does not match: every
 * read already hides it, so a write must not succeed on it either.
 */
export async function updateAssetMetadata(
  id: string,
  data: Partial<Pick<VideoAsset, 'title' | 'description' | 'accessTier'>>,
  owner?: string,
): Promise<VideoAsset | undefined> {
  const scope = [eq(videoAssets.id, id), isNull(videoAssets.deletedAt)];
  if (owner !== undefined) scope.push(eq(videoAssets.creatorAddress, owner));
  // a tier that actually changes revokes every signed url of the asset, in
  // the same statement, so no url outlives the change it was minted under
  const tierChange =
    data.accessTier !== undefined
      ? sql`${videoAssets.accessTier} <> ${data.accessTier}::access_tier`
      : undefined;
  const [updated] = await db
    .update(videoAssets)
    .set({
      ...data,
      ...(tierChange
        ? {
            signingGeneration: sql`case when ${tierChange} then ${videoAssets.signingGeneration} + 1 else ${videoAssets.signingGeneration} end`,
            legacySignaturesUntil: sql`case when ${tierChange} then null else ${videoAssets.legacySignaturesUntil} end`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(...scope))
    .returning();
  return updated;
}

/**
 * Revoke every signed url of an asset by raising its signing generation (and
 * closing the window of urls signed before generations existed). Returns the
 * new generation, or undefined when there is no such live asset.
 */
export async function raiseSigningGeneration(
  id: string,
  owner?: string,
): Promise<number | undefined> {
  const scope = [eq(videoAssets.id, id), isNull(videoAssets.deletedAt)];
  if (owner !== undefined) scope.push(eq(videoAssets.creatorAddress, owner));
  const [row] = await db
    .update(videoAssets)
    .set({
      signingGeneration: sql`${videoAssets.signingGeneration} + 1`,
      legacySignaturesUntil: null,
    })
    .where(and(...scope))
    .returning({ signingGeneration: videoAssets.signingGeneration });
  return row?.signingGeneration;
}

/**
 * Physically remove a video asset row (cascading to its renditions,
 * artifacts, jobs, and playback ids). Used by the deletion worker AFTER the
 * asset's Sia objects have been unpinned; API callers use
 * {@link softDeleteVideoAsset} instead.
 *
 * Its upload sessions stay (the foreign key clears their link) because the
 * source sweep finds a leftover file through them, but their tus metadata,
 * which holds the title and the owner, goes with the asset. The sweep deletes
 * the session once the file is gone (deleteDetachedUploadSessions).
 */
export async function deleteVideoAsset(
  id: string,
  owner?: string,
): Promise<VideoAsset | undefined> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: videoAssets.id })
      .from(videoAssets)
      .where(
        owner !== undefined
          ? and(eq(videoAssets.id, id), eq(videoAssets.creatorAddress, owner))
          : eq(videoAssets.id, id),
      )
      .for('update');
    if (!target) return undefined;
    // while the link still says which sessions were this asset's
    await tx
      .update(uploadSessions)
      .set({ metadata: {} })
      .where(eq(uploadSessions.videoAssetId, id));
    const [deleted] = await tx.delete(videoAssets).where(eq(videoAssets.id, id)).returning();
    return deleted;
  });
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
  const scope =
    owner !== undefined
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
 * can unpin each. Reads the authoritative `artifacts` rows, the denormalized
 * ids on the asset itself (covering assets that predate artifact
 * normalization), and the objects a run pinned that finalize has not
 * recorded yet. Deliberately does NOT filter on `deletedAt`: it must see the
 * just-soft-deleted row.
 */
export async function getAssetObjectIds(assetId: string): Promise<string[]> {
  const [artifactRows, pendingRows, asset] = await Promise.all([
    db
      .select({ objectId: artifacts.objectId })
      .from(artifacts)
      .where(eq(artifacts.videoAssetId, assetId)),
    db
      .select({ objectId: pendingObjects.objectId })
      .from(pendingObjects)
      .where(eq(pendingObjects.videoAssetId, assetId)),
    db.query.videoAssets.findFirst({
      where: eq(videoAssets.id, assetId),
      columns: { manifestObjectId: true, thumbnailObjectIds: true, siaObjectIds: true },
    }),
  ]);

  return collectAssetObjectIds({
    artifactObjectIds: [...artifactRows, ...pendingRows].map((r) => r.objectId),
    manifestObjectId: asset?.manifestObjectId ?? null,
    thumbnailObjectIds: asset?.thumbnailObjectIds ?? [],
    siaObjectIds: (asset?.siaObjectIds ?? []) as string[],
  });
}

/**
 * Record that specific objects have been unpinned during a deletion: remove
 * their artifact and pending rows and strip them from the asset's
 * denormalized id fields. This is what lets a retried or GC-re-driven
 * deletion converge: the next `getAssetObjectIds` returns only the objects
 * that still need unpinning. The fields are filtered inside one UPDATE, so
 * two deletions of the same asset cannot write back an id the other removed.
 */
export async function markObjectsUnpinned(assetId: string, unpinnedIds: string[]): Promise<void> {
  if (unpinnedIds.length === 0) return;
  const ids = sql`${sql.param(unpinnedIds)}::text[]`;
  await db.transaction(async (tx) => {
    await tx
      .delete(artifacts)
      .where(and(eq(artifacts.videoAssetId, assetId), inArray(artifacts.objectId, unpinnedIds)));
    await tx.delete(pendingObjects).where(inArray(pendingObjects.objectId, unpinnedIds));
    await tx
      .update(videoAssets)
      .set({
        manifestObjectId: sql`case when ${videoAssets.manifestObjectId} = any(${ids}) then null else ${videoAssets.manifestObjectId} end`,
        thumbnailObjectIds: sql`array(
          select t from unnest(${videoAssets.thumbnailObjectIds}) with ordinality as u(t, n)
          where not (t = any(${ids})) order by n
        )`,
        siaObjectIds: sql`coalesce((
          select jsonb_agg(e order by n)
          from jsonb_array_elements_text(coalesce(${videoAssets.siaObjectIds}, '[]'::jsonb)) with ordinality as u(e, n)
          where not (e = any(${ids}))
        ), '[]'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(videoAssets.id, assetId));
  });
}

/**
 * Move a failed asset back to processing for a retry. Only one caller can
 * win: the status check and the write are one statement, so two retries at
 * once start one run. Returns false when the asset is not failed (or not the
 * caller's, or being deleted).
 */
export async function claimFailedAssetForRetry(id: string, owner?: string): Promise<boolean> {
  const scope = [
    eq(videoAssets.id, id),
    eq(videoAssets.status, 'failed'),
    isNull(videoAssets.deletedAt),
  ];
  if (owner !== undefined) scope.push(eq(videoAssets.creatorAddress, owner));
  const rows = await db
    .update(videoAssets)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(and(...scope))
    .returning({ id: videoAssets.id });
  return rows.length > 0;
}

/**
 * Bytes of upload `uploadId` (its session id) started arriving: move the
 * asset it created from created to uploading. Any other status, a deleted
 * asset or a session that is no longer receiving leaves the row alone, so the
 * many writes after the first, and a write that lands after the pipeline took
 * over, change nothing. Returns whether it moved.
 */
export async function markAssetUploading(uploadId: string): Promise<boolean> {
  const rows = await db
    .update(videoAssets)
    .set({ status: 'uploading', updatedAt: new Date() })
    .where(
      and(
        eq(videoAssets.status, 'created'),
        isNull(videoAssets.deletedAt),
        inArray(
          videoAssets.id,
          db
            .select({ id: uploadSessions.videoAssetId })
            .from(uploadSessions)
            .where(and(eq(uploadSessions.id, uploadId), eq(uploadSessions.status, 'uploading'))),
        ),
      ),
    )
    .returning({ id: videoAssets.id });
  return rows.length > 0;
}

/**
 * Mark an asset whose pipeline gave up failed. A ready or failed asset does
 * not match, so a stale execution failing after its asset became ready (or
 * after the run already failed) changes nothing. Created counts, for a first
 * transcode attempt that failed before it could mark the asset processing.
 * Returns whether it moved.
 */
export async function failProcessingAsset(id: string): Promise<boolean> {
  const rows = await db
    .update(videoAssets)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(
      and(
        eq(videoAssets.id, id),
        inArray(videoAssets.status, ['created', 'uploading', 'processing']),
        isNull(videoAssets.deletedAt),
      ),
    )
    .returning({ id: videoAssets.id });
  return rows.length > 0;
}

/** Undo a retry claim whose job could not be queued, so the asset can be retried again. */
export async function releaseRetryClaim(id: string): Promise<void> {
  await db
    .update(videoAssets)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(and(eq(videoAssets.id, id), eq(videoAssets.status, 'processing')));
}

/**
 * Whether each asset still needs its transcode output: a processing or
 * failed asset does (the pipeline or a retry reads it), a ready, deleted or
 * missing one does not.
 */
export async function transcodeOutputDispositions(
  ids: string[],
): Promise<Map<string, 'keep' | 'remove'>> {
  const result = new Map<string, 'keep' | 'remove'>(ids.map((id) => [id, 'remove']));
  if (ids.length === 0) return result;
  const rows = await db
    .select({ id: videoAssets.id, status: videoAssets.status, deletedAt: videoAssets.deletedAt })
    .from(videoAssets)
    .where(inArray(videoAssets.id, ids));
  for (const row of rows) {
    if (row.deletedAt === null && row.status !== 'ready') result.set(row.id, 'keep');
  }
  return result;
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
