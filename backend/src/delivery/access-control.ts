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

/**
 * Delivery decision for an object:
 * - 'public'  — serve openly
 * - 'private' — require a valid signed URL (private tier OR a signed-policy handle)
 * - 'gone'    — the owning asset is being deleted; do not serve (404)
 * - 'unknown' — no asset claims it; treated as public (carries no private data)
 */
export type ObjectTier = AccessTier | 'unknown' | 'gone';

const tierCache = new LRUCache<string, ObjectTier>({
  max: 10_000,
  ttl: TIER_TTL_MS,
});

/**
 * Resolve how an object id must be delivered. An object whose owning asset is
 * soft-deleted resolves to 'gone'; an object whose asset is private OR has a
 * signed-policy playback id resolves to 'private' (a signature is required
 * even for a public-tier asset, so a 'signed' handle actually gates the whole
 * object graph, not just the /v1/stream entry point).
 */
export async function getObjectAccessTier(objectId: string): Promise<ObjectTier> {
  const cached = tierCache.get(objectId);
  if (cached) return cached;

  let tier: ObjectTier = 'unknown';
  try {
    const rows = await db.execute<{
      access_tier: AccessTier;
      deleted_at: string | null;
      has_signed: boolean;
    }>(sql`
      select
        va.access_tier,
        va.deleted_at,
        exists(
          select 1 from playback_ids p
          where p.video_asset_id = va.id and p.policy = 'signed'
        ) as has_signed
      from video_assets va
      where va.id in (
        select a.video_asset_id from artifacts a where a.object_id = ${objectId}
        union
        select va2.id from video_assets va2
          where va2.manifest_object_id = ${objectId}
             or ${objectId} = any(va2.thumbnail_object_ids)
             or va2.sia_object_ids @> to_jsonb(${objectId}::text)
      )
      -- Prefer a deleted asset (so its objects stop being served), then a
      -- private one, so a single row settles the decision.
      order by (va.deleted_at is not null) desc, va.access_tier
      limit 1
    `);

    const first = (
      rows as unknown as Array<{
        access_tier: AccessTier;
        deleted_at: string | null;
        has_signed: boolean;
      }>
    )[0];

    if (first) {
      if (first.deleted_at) tier = 'gone';
      else if (first.access_tier === 'private' || first.has_signed) tier = 'private';
      else tier = 'public';
    }
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
