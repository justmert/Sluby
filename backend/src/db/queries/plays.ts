import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { assetPlaysDaily, videoAssets } from '../schema.js';
import type { PlayRow } from '../../delivery/plays.js';

/**
 * Add buffered plays: one upsert into asset_plays_daily and one update of
 * last_played_at. Rows of an asset deleted since are skipped rather than
 * failing the batch on the foreign key.
 */
export async function writePlays(rows: PlayRow[]): Promise<void> {
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.assetId);
  const days = rows.map((r) => r.day);
  const counts = rows.map((r) => r.plays);
  const lastAt = rows.map((r) => r.lastPlayedAt.toISOString());
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into asset_plays_daily (video_asset_id, day, plays)
      select p.id, p.day, p.plays
      from unnest(${pgArray(ids)}::uuid[], ${pgArray(days)}::date[], ${pgArray(counts)}::int[])
        as p(id, day, plays)
      join video_assets va on va.id = p.id
      on conflict (video_asset_id, day)
      do update set plays = asset_plays_daily.plays + excluded.plays
    `);
    // updated_at stays: it is the asset's version (ETag), and a play is not an edit
    await tx.execute(sql`
      update video_assets va
      set last_played_at = greatest(va.last_played_at, p.at)
      from (
        select id, max(at) as at
        from unnest(${pgArray(ids)}::uuid[], ${pgArray(lastAt)}::timestamptz[]) as u(id, at)
        group by id
      ) p
      where va.id = p.id
    `);
  });
}

// a postgres array literal for a parameter, so a whole batch is one parameter
function pgArray(values: Array<string | number>): string {
  return `{${values.map((v) => (typeof v === 'number' ? String(v) : `"${v}"`)).join(',')}}`;
}

/** All-time plays of each asset; assets without any are left out. */
export async function getPlayCounts(assetIds: string[]): Promise<Map<string, number>> {
  if (assetIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: assetPlaysDaily.videoAssetId,
      plays: sql<string>`sum(${assetPlaysDaily.plays})`,
    })
    .from(assetPlaysDaily)
    .where(inArray(assetPlaysDaily.videoAssetId, assetIds))
    .groupBy(assetPlaysDaily.videoAssetId);
  return new Map(rows.map((r) => [r.id, Number(r.plays)]));
}

/**
 * Plays per UTC day of one account's videos (every account for an undefined
 * owner), from `since` (YYYY-MM-DD) on. Days without plays are left out.
 */
export async function getDailyPlays(
  owner: string | undefined,
  since: string,
): Promise<Array<{ day: string; plays: number }>> {
  const conditions: SQL[] = [gte(assetPlaysDaily.day, since)];
  if (owner !== undefined) conditions.push(eq(videoAssets.creatorAddress, owner));
  const rows = await db
    .select({
      day: assetPlaysDaily.day,
      plays: sql<string>`sum(${assetPlaysDaily.plays})`,
    })
    .from(assetPlaysDaily)
    .innerJoin(videoAssets, eq(videoAssets.id, assetPlaysDaily.videoAssetId))
    .where(and(...conditions))
    .groupBy(assetPlaysDaily.day);
  return rows.map((r) => ({ day: r.day, plays: Number(r.plays) }));
}
