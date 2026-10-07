import { sql } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { db } from '../config/database.js';
import type { SigningState } from './signed-url.js';

/**
 * Decides how the delivery gateway may hand out a stored Sia object.
 *
 * Object ids are opaque, so an id is mapped back to the asset that owns it
 * through the `artifacts` table, which holds every stored object id of every
 * asset (finalize writes the rows, migration 0009 backfilled older assets).
 * The decision follows only the asset itself: its access tier, whether it is
 * being deleted, and its signing state. Playback ids play no part here; a
 * signed playback id gates its own /v1/stream entry, not the objects.
 *
 * Two caches keep the hot path off the database. Which assets claim an object
 * never changes while the object exists, so that map is kept for minutes. The
 * asset's state can change, so it is kept for a minute at most and dropped at
 * once by every change made through this process (tier edit, revoke, delete).
 * A second backend process does not see those drops and catches up within
 * the minute.
 */

export type AccessTier = 'public' | 'private';

export type ObjectAccess =
  /** no live asset claims the object: not served */
  | { kind: 'unknown' }
  /** the owning asset is being deleted: not served */
  | { kind: 'gone' }
  | { kind: 'public'; assetId: string }
  /** needs a signed url verified against `signing` */
  | { kind: 'private'; assetId: string; signing: SigningState };

interface AssetAccessState {
  tier: AccessTier;
  deleted: boolean;
  signing: SigningState;
}

const OBJECT_ID_RE = /^[0-9a-f]{64}$/;

/** A Sia object id as the indexer hands it out: 32 bytes, lowercase hex. */
export function isObjectId(id: string): boolean {
  return OBJECT_ID_RE.test(id);
}

const ASSET_STATE_TTL_MS = 60_000;
const OBJECT_OWNER_TTL_MS = 5 * 60_000;
// an id no asset claims yet may be claimed by a finalize a moment later
const UNCLAIMED_TTL_MS = 60_000;

const objectOwners = new LRUCache<string, string[]>({ max: 50_000, ttl: OBJECT_OWNER_TTL_MS });
const assetStates = new LRUCache<string, AssetAccessState | 'missing'>({
  max: 20_000,
  ttl: ASSET_STATE_TTL_MS,
});

interface StateRow {
  id: string;
  access_tier: AccessTier;
  deleted: boolean;
  signing_generation: number;
  legacy_until: string | number | null;
}

function toState(row: StateRow): AssetAccessState {
  return {
    tier: row.access_tier,
    deleted: row.deleted,
    signing: {
      generation: Number(row.signing_generation),
      legacyUntilSec: row.legacy_until === null ? null : Number(row.legacy_until),
    },
  };
}

// the legacy window as unix seconds, so it needs no date parsing here
const stateColumns = sql`
  va.id,
  va.access_tier,
  va.deleted_at is not null as deleted,
  va.signing_generation,
  floor(extract(epoch from va.legacy_signatures_until))::bigint as legacy_until
`;

/**
 * The assets claiming an object, with their state. One index lookup on
 * artifacts.object_id plus primary key reads, whatever the table sizes.
 * Exported so a test can check the plan.
 */
export function objectOwnersQuery(objectId: string) {
  return sql`
    select distinct ${stateColumns}
    from artifacts a
    join video_assets va on va.id = a.video_asset_id
    where a.object_id = ${objectId}
  `;
}

async function loadByObject(objectId: string): Promise<string[]> {
  const rows = (await db.execute(objectOwnersQuery(objectId))) as unknown as StateRow[];
  const owners = rows.map((r) => r.id);
  for (const r of rows) assetStates.set(r.id, toState(r));
  objectOwners.set(objectId, owners, owners.length === 0 ? { ttl: UNCLAIMED_TTL_MS } : undefined);
  return owners;
}

async function loadAssetStates(assetIds: string[]): Promise<void> {
  const rows = (await db.execute(sql`
    select ${stateColumns}
    from video_assets va
    where va.id in (${sql.join(
      assetIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `)) as unknown as StateRow[];
  const found = new Set<string>();
  for (const r of rows) {
    assetStates.set(r.id, toState(r));
    found.add(r.id);
  }
  // the row is gone: the asset finished deleting after the owners were cached
  for (const id of assetIds) if (!found.has(id)) assetStates.set(id, 'missing');
}

/**
 * Resolve how an object may be delivered. Throws when the database cannot be
 * read, so the caller answers "try again" instead of serving or refusing on a
 * guess.
 *
 * Should one object ever be claimed by more than one asset, the strictest
 * claim wins: any asset being deleted makes it gone, any private one makes it
 * private.
 */
export async function resolveObjectAccess(objectId: string): Promise<ObjectAccess> {
  let owners = objectOwners.get(objectId);
  if (owners === undefined) {
    owners = await loadByObject(objectId);
  } else {
    const stale = owners.filter((id) => !assetStates.has(id));
    if (stale.length > 0) await loadAssetStates(stale);
  }

  const states: Array<{ assetId: string; state: AssetAccessState }> = [];
  for (const assetId of owners) {
    const state = assetStates.get(assetId);
    if (state && state !== 'missing') states.push({ assetId, state });
  }
  if (states.length === 0) return { kind: 'unknown' };
  if (states.some((s) => s.state.deleted)) return { kind: 'gone' };
  const priv = states.find((s) => s.state.tier === 'private');
  if (priv) return { kind: 'private', assetId: priv.assetId, signing: priv.state.signing };
  return { kind: 'public', assetId: states[0].assetId };
}

/**
 * Forget an asset's cached state, so the next request re-reads it. Called on
 * every change that affects delivery: a tier edit, a revoke, a delete.
 */
export function invalidateAssetAccess(assetId: string): void {
  assetStates.delete(assetId);
}

/** Forget which assets claim an object, e.g. once it has been unpinned. */
export function invalidateObjectAccessTier(objectId: string): void {
  objectOwners.delete(objectId);
}
