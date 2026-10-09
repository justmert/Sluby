import type { VideoAsset } from '@sluby/sdk';

/** A video as the sdk maps it, for component tests. */
export function video(id: string, title: string, over: Partial<VideoAsset> = {}): VideoAsset {
  return {
    id,
    title,
    description: '',
    manifestObjectId: 'm',
    thumbnailObjectIds: [],
    durationMs: 90_000,
    resolution: '1280x720',
    status: 'ready',
    accessTier: 'public',
    creatorAddress: 'github:dev',
    segmentCount: 1,
    totalStorageBytes: 3_100_000,
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}
