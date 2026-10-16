import type { VideoAsset } from '@sluby/sdk';
import { useAssetList } from '@/hooks/asset-queries';

/** The newest ready videos the picker offers. */
const PICKER_LIMIT = 50;

/**
 * The ready videos, newest first, for filling a real video ID into code.
 * `selected` is the picked video, or the newest one until something is
 * picked; undefined while loading, null when there is no ready video.
 */
export function useReadyVideos(pickedId: string | null) {
  const list = useAssetList({
    status: 'ready',
    sort: 'created_at',
    order: 'desc',
    limit: PICKER_LIMIT,
  });
  const videos = list.data?.data;
  const selected: VideoAsset | null | undefined = videos
    ? (videos.find((v) => v.id === pickedId) ?? videos[0] ?? null)
    : list.isError
      ? null
      : undefined;
  return { list, videos, selected };
}
