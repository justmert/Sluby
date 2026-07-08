import { eq, desc } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { playbackIds, videoAssets, type PlaybackId } from '../schema.js';
import { generatePlaybackId, isPlaybackId } from '../../api/playback-id.js';

/**
 * Create a playback id for an asset. Returns null if the asset does not
 * exist, so the route can answer 404 rather than insert a dangling row.
 */
export async function createPlaybackIdForAsset(
  assetId: string,
  opts: { policy?: 'public' | 'signed'; name?: string } = {},
): Promise<PlaybackId | null> {
  const asset = await db.query.videoAssets.findFirst({
    where: eq(videoAssets.id, assetId),
    columns: { id: true },
  });
  if (!asset) return null;

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

export async function listPlaybackIdsByAsset(
  assetId: string,
): Promise<PlaybackId[]> {
  return db.query.playbackIds.findMany({
    where: eq(playbackIds.videoAssetId, assetId),
    orderBy: [desc(playbackIds.createdAt)],
  });
}

/** Resolve a public `pb_...` handle to its playback id row. */
export async function getPlaybackIdByPublicId(
  publicId: string,
): Promise<PlaybackId | undefined> {
  return db.query.playbackIds.findFirst({
    where: eq(playbackIds.playbackId, publicId),
  });
}

/** Delete by public handle. Returns true if a row was removed. */
export async function deletePlaybackIdByPublicId(
  publicId: string,
): Promise<boolean> {
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
