import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  reconciliationRuns,
  artifacts,
  videoAssets,
  indexerObjects,
  reconcileFeed,
  pendingObjects,
  type ReconciliationRun,
} from '../schema.js';
import {
  RECONCILE_RUNS_KEPT,
  type PendingObjectState,
  type ReconciliationSummary,
} from '../../reconcile/reconciler.js';
import type { FeedStore, ObjectEventLite } from '../../reconcile/collect-inventory.js';
import type { IndexerObjectState } from '../../reconcile/inventory-diff.js';

/**
 * Persist a completed reconciliation run and drop the runs before the latest
 * `keep`, so the table (each row carries full id lists) stays bounded.
 */
export async function recordReconciliationRun(
  summary: ReconciliationSummary,
  keep = RECONCILE_RUNS_KEPT,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(reconciliationRuns).values({
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      status: summary.status,
      dbObjectCount: summary.dbObjectCount,
      indexerObjectCount: summary.indexerObjectCount,
      inSyncCount: summary.inSyncCount,
      orphanCount: summary.orphanCount,
      missingCount: summary.missingCount,
      orphanedIds: summary.orphanedIds,
      missingIds: summary.missingIds,
      errorMessage: summary.errorMessage ?? null,
    });
    await tx.execute(sql`
      delete from ${reconciliationRuns} where id in (
        select id from ${reconciliationRuns}
        order by finished_at desc, id desc
        offset ${keep}
      )
    `);
  });
}

export async function getLatestReconciliationRun(): Promise<ReconciliationRun | undefined> {
  return db.query.reconciliationRuns.findFirst({
    orderBy: [desc(reconciliationRuns.finishedAt)],
  });
}

/**
 * The saved copy of the indexer's inventory (indexer_objects) and the feed
 * cursor it was read up to (reconcile_feed), see syncObjectFeed.
 */
export const indexerFeedStore: FeedStore = {
  begin: (feed) =>
    db.transaction(async (tx) => {
      // the row lock also keeps two runs from syncing at once
      const [row] = await tx.select().from(reconcileFeed).for('update');
      if (row?.feed === feed) {
        return row.cursorId && row.cursorAfter
          ? { id: row.cursorId, after: row.cursorAfter }
          : null;
      }
      // another indexer or account, or the first run: start the copy over
      await tx.delete(indexerObjects);
      await tx.delete(reconcileFeed);
      await tx.insert(reconcileFeed).values({ feed });
      return null;
    }),

  applyPage: (feed, events, cursor) =>
    db.transaction(async (tx) => {
      // one row per id, the later event winning, as one statement cannot
      // update a row twice
      const latest = new Map<string, ObjectEventLite>();
      for (const e of events) latest.set(e.id, e);
      if (latest.size > 0) {
        await tx
          .insert(indexerObjects)
          .values(
            [...latest.values()].map((e) => ({
              objectId: e.id,
              deleted: e.deleted,
              eventAt: e.updatedAt,
            })),
          )
          .onConflictDoUpdate({
            target: indexerObjects.objectId,
            set: { deleted: sql`excluded.deleted`, eventAt: sql`excluded.event_at` },
            // a re-read older event never overwrites a newer one
            setWhere: sql`${indexerObjects.eventAt} <= excluded.event_at`,
          });
      }
      const saved = await tx
        .update(reconcileFeed)
        .set({
          cursorId: cursor?.id ?? null,
          cursorAfter: cursor?.after ?? null,
          updatedAt: new Date(),
        })
        .where(eq(reconcileFeed.feed, feed))
        .returning({ feed: reconcileFeed.feed });
      if (saved.length === 0) {
        throw new Error(`the saved indexer inventory is no longer for ${feed}`);
      }
    }),

  pruneDeleted: async (before) => {
    await db
      .delete(indexerObjects)
      .where(and(eq(indexerObjects.deleted, true), lt(indexerObjects.eventAt, before)));
  },
};

/** The saved copy of the indexer's inventory, by object id. */
export async function getIndexerInventory(): Promise<Map<string, IndexerObjectState>> {
  const rows = await db.select().from(indexerObjects);
  return new Map(rows.map((r) => [r.objectId, { deleted: r.deleted, eventAt: r.eventAt }]));
}

/**
 * Gather every Sia object id the database believes it has stored. The
 * `artifacts` table is authoritative (one row per stored object), but we
 * also fold in the denormalized ids on `video_assets` so assets that
 * predate artifact normalization are still covered. Empty/null ids are
 * dropped.
 */
export async function getAllTrackedObjectIds(): Promise<string[]> {
  const [artifactRows, assetRows] = await Promise.all([
    db.select({ objectId: artifacts.objectId }).from(artifacts),
    db
      .select({
        manifestObjectId: videoAssets.manifestObjectId,
        thumbnailObjectIds: videoAssets.thumbnailObjectIds,
        siaObjectIds: videoAssets.siaObjectIds,
      })
      .from(videoAssets),
  ]);

  const ids = new Set<string>();
  for (const row of artifactRows) {
    if (row.objectId) ids.add(row.objectId);
  }
  for (const row of assetRows) {
    if (row.manifestObjectId) ids.add(row.manifestObjectId);
    for (const t of row.thumbnailObjectIds ?? []) {
      if (t) ids.add(t);
    }
    for (const s of (row.siaObjectIds ?? []) as string[]) {
      if (s) ids.add(s);
    }
  }
  return [...ids];
}

/**
 * Every object the pipeline has pinned, or is about to pin, that finalize has
 * not recorded in artifacts yet, and every object waiting to be unpinned (see
 * pending_objects in the schema). `updatedAt` of a release row is when it was
 * marked for release.
 */
export async function listPendingObjectStates(): Promise<PendingObjectState[]> {
  return db
    .select({
      objectId: pendingObjects.objectId,
      state: pendingObjects.state,
      updatedAt: pendingObjects.updatedAt,
    })
    .from(pendingObjects);
}

/**
 * The subset of `ids` that belong to `owner`'s assets, in the order given.
 * Ownership comes from the same places the inventory reads (artifacts plus
 * the ids on video_assets), soft-deleted assets included, so a tenant sees
 * exactly the part of a run that was about their objects. The ids go in as
 * one jsonb parameter because a run's list can exceed postgres' bind limit.
 */
export async function filterObjectIdsOwnedBy(ids: string[], owner: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<{ id: string }>(sql`
    select owned.id from (
      select a.object_id as id
        from ${artifacts} a join ${videoAssets} v on v.id = a.video_asset_id
        where v.creator_address = ${owner}
      union
      select v.manifest_object_id from ${videoAssets} v
        where v.creator_address = ${owner} and v.manifest_object_id is not null
      union
      select unnest(v.thumbnail_object_ids) from ${videoAssets} v
        where v.creator_address = ${owner}
      union
      select jsonb_array_elements_text(v.sia_object_ids) from ${videoAssets} v
        where v.creator_address = ${owner} and jsonb_typeof(v.sia_object_ids) = 'array'
    ) owned
    where owned.id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
  `);
  const owned = new Set(rows.map((r) => r.id));
  return ids.filter((id) => owned.has(id));
}

/** The video an object belongs to, for a link from the reconciliation report. */
export interface ObjectVideo {
  objectId: string;
  videoAssetId: string;
  title: string;
}

/**
 * The live (not deleted) video each object id belongs to, through the same
 * columns filterObjectIdsOwnedBy reads: artifacts, and the object id columns
 * of the asset. `owner` undefined looks across every account. An id no live
 * video holds is left out; should one be held by several, the oldest wins.
 */
export async function findVideosForObjectIds(
  ids: string[],
  owner: string | undefined,
): Promise<ObjectVideo[]> {
  if (ids.length === 0) return [];
  const wanted = sql`(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
  const ownedBy = owner !== undefined ? sql`and v.creator_address = ${owner}` : sql``;
  const rows = await db.execute<{ object_id: string; video_asset_id: string; title: string }>(sql`
    select distinct on (o.object_id) o.object_id, v.id as video_asset_id, v.title
    from (
      select a.object_id, a.video_asset_id as asset_id from ${artifacts} a
        where a.object_id in ${wanted}
      union all
      select v.manifest_object_id, v.id from ${videoAssets} v
        where v.manifest_object_id in ${wanted}
      union all
      select t.id, v.id from ${videoAssets} v, unnest(v.thumbnail_object_ids) as t(id)
        where t.id in ${wanted}
      union all
      select s.id, v.id from ${videoAssets} v, jsonb_array_elements_text(
          case when jsonb_typeof(v.sia_object_ids) = 'array' then v.sia_object_ids else '[]'::jsonb end
        ) as s(id)
        where s.id in ${wanted}
    ) o
    join ${videoAssets} v on v.id = o.asset_id
    where v.deleted_at is null ${ownedBy}
    order by o.object_id, v.created_at, v.id
  `);
  return rows.map((r) => ({
    objectId: r.object_id,
    videoAssetId: r.video_asset_id,
    title: r.title,
  }));
}
