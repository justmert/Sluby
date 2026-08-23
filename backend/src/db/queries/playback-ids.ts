import { and, eq, desc, inArray, isNull } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { playbackIds, videoAssets, type PlaybackId } from '../schema.js';
import { generatePlaybackId, isPlaybackId } from '../../api/playback-id.js';

/**
 * Confirm an asset exists and, when `owner` is given, that it belongs to that
 * tenant. Playback ids are keyed off an asset, so every management operation
 * gates on this first: without it a caller could manage playback ids on
 * another tenant's asset by guessing its UUID. `owner` is undefined for a
 * platform key, which is allowed to act across tenants.
 */
async function assetIsOwned(assetId: string, owner?: string): Promise<boolean> {
  const asset = await db.query.videoAssets.findFirst({
    where: owner
      ? and(
          eq(videoAssets.id, assetId),
          eq(videoAssets.creatorAddress, owner),
          isNull(videoAssets.deletedAt),
        )
      : and(eq(videoAssets.id, assetId), isNull(videoAssets.deletedAt)),
    columns: { id: true },
  });
  return Boolean(asset);
}

/**
 * Create a playback id for an asset. Returns null if the asset does not
 * exist or is not owned by `owner`, so the route can answer 404 rather than
 * insert a dangling or cross-tenant row.
 */
export async function createPlaybackIdForAsset(
  assetId: string,
  opts: { policy?: 'public' | 'signed'; name?: string } = {},
  owner?: string,
): Promise<PlaybackId | null> {
  if (!(await assetIsOwned(assetId, owner))) return null;

  const [row] = await db
    .insert(playbackIds)
    .values({
      playbackId: generatePlaybackId(),
      videoAssetId: assetId,
      policy: opts.policy ?? 'public',
      name: opts.name ?? '',
    })
    .returning();
  return row;
}

/**
 * List playback ids for an asset. Returns null when the asset does not exist
 * or is not owned by `owner` (so the route answers 404 without revealing
 * another tenant's asset), otherwise the asset's playback ids.
 */
export async function listPlaybackIdsByAsset(
  assetId: string,
  owner?: string,
): Promise<PlaybackId[] | null> {
  if (!(await assetIsOwned(assetId, owner))) return null;
  return db.query.playbackIds.findMany({
    where: eq(playbackIds.videoAssetId, assetId),
    orderBy: [desc(playbackIds.createdAt)],
  });
}

/** Resolve a public `pb_...` handle to its playback id row. */
export async function getPlaybackIdByPublicId(publicId: string): Promise<PlaybackId | undefined> {
  return db.query.playbackIds.findFirst({
    where: eq(playbackIds.playbackId, publicId),
  });
}

/**
 * Delete by public handle, only when the caller owns the underlying asset.
 * Returns true if a row was removed. When `owner` is given, a handle whose
 * asset belongs to another tenant is left untouched and reported as not
 * deleted (the route answers 404).
 */
export async function deletePlaybackIdByPublicId(
  publicId: string,
  owner?: string,
): Promise<boolean> {
  if (owner) {
    // Scope the delete to handles whose asset belongs to `owner`. The
    // subquery yields only this tenant's asset ids, so a handle on another
    // tenant's asset matches nothing.
    const ownedAssetIds = db
      .select({ id: videoAssets.id })
      .from(videoAssets)
      .where(and(eq(videoAssets.creatorAddress, owner), isNull(videoAssets.deletedAt)));
    const deleted = await db
      .delete(playbackIds)
      .where(
        and(eq(playbackIds.playbackId, publicId), inArray(playbackIds.videoAssetId, ownedAssetIds)),
      )
      .returning({ id: playbackIds.id });
    return deleted.length > 0;
  }

  const deleted = await db
    .delete(playbackIds)
    .where(eq(playbackIds.playbackId, publicId))
    .returning({ id: playbackIds.id });
  return deleted.length > 0;
}

/**
 * Resolve a path parameter that may be either an internal asset UUID or a
 * public `pb_...` playback id into the asset UUID. Returns null when a
 * playback id does not resolve to any asset. A non-playback-id value is
 * returned unchanged (callers still validate the asset itself).
 */
export async function resolveAssetId(param: string): Promise<string | null> {
  if (!isPlaybackId(param)) return param;
  const pb = await getPlaybackIdByPublicId(param);
  return pb?.videoAssetId ?? null;
}
