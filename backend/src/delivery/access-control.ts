import { sql } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { db } from '../config/database.js';
import { logger } from '../config/logger.js';

/**
 * Resolves which access tier a stored Sia object belongs to, so the delivery
 * gateway can require a signed URL for private content.
 *
 * Object ids are opaque, so this maps an id back to its owning asset. The
 * `artifacts` table is the authoritative object-id map, but assets created
 * before artifact normalization only carry their ids denormalized on
 * `video_assets`, so both are checked.
 *
 * Results are cached: an object's owning asset never changes, and only the
 * asset's tier can flip (rarely), so a short TTL keeps the hot delivery path
 * off the database without letting a tier change go unnoticed for long.
 */

export type AccessTier = 'public' | 'private';

const TIER_TTL_MS = 60_000;

const tierCache = new LRUCache<string, AccessTier | 'unknown'>({
  max: 10_000,
  ttl: TIER_TTL_MS,
});

/**
 * Returns the access tier for an object id, or 'unknown' when no asset
 * claims it. Callers decide how to treat 'unknown'; the gateway treats it as
 * public because an unclaimed object carries no private asset's data.
 */
export async function getObjectAccessTier(objectId: string): Promise<AccessTier | 'unknown'> {
  const cached = tierCache.get(objectId);
  if (cached) return cached;

  let tier: AccessTier | 'unknown' = 'unknown';
  try {
    // If any owning asset is private, treat the object as private. `order by`
    // puts 'private' first so a single row settles it.
    const rows = await db.execute<{ access_tier: AccessTier }>(sql`
      select va.access_tier from artifacts a
        join video_assets va on va.id = a.video_asset_id
        where a.object_id = ${objectId}
      union
      select va.access_tier from video_assets va
        where va.manifest_object_id = ${objectId}
           or ${objectId} = any(va.thumbnail_object_ids)
           or va.sia_object_ids @> to_jsonb(${objectId}::text)
      order by access_tier
      limit 1
    `);

    const first = (rows as unknown as Array<{ access_tier: AccessTier }>)[0];
    if (first?.access_tier) tier = first.access_tier;
  } catch (err) {
    // Fail closed: if we cannot determine the tier we must not hand out bytes
    // that might belong to a private asset.
    logger.error({ objectId, err }, 'Failed to resolve object access tier');
    throw err;
  }

  tierCache.set(objectId, tier);
  return tier;
}

/** Drop a cached tier, e.g. after an asset's access tier is changed. */
export function invalidateObjectAccessTier(objectId: string): void {
  tierCache.delete(objectId);
}
