import type { VideoAsset } from '@sluby/sdk';
import { jobSummary, processingView } from '@/components/asset/processing';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import { formatBytes, formatDuration, formatRelativeTime } from '@/lib/formatters';

// a row polls its job a little slower than the video page, which is about
// one video; the query key is the video page's, so a row and an open page
// (or the upload tray) share one request per poll
const ROW_POLL_MS = 5_000;

export interface RowProgress {
  /** "Storing on Sia, 65%" */
  label: string;
  percent: number | null;
  /** the last poll failed; the row keeps the stage it last knew */
  checking: boolean;
}

/** Where a processing video is, polled while it is on screen; undefined for any other status. */
export function useRowProgress(asset: VideoAsset): RowProgress | undefined {
  const processing = asset.status === 'processing';
  const job = useProcessingJob(asset.id, asset.status, processing, ROW_POLL_MS);
  if (!processing || !job.data) return undefined;
  return {
    label: jobSummary(job.data),
    percent: processingView(job.data).percent,
    checking: job.isError,
  };
}

/** The phone card's facts line: "0:10 · 3.1 MB · 2 hours ago". */
export function videoMeta(asset: VideoAsset): string {
  return [
    asset.durationMs ? formatDuration(asset.durationMs) : null,
    asset.totalStorageBytes > 0 ? formatBytes(asset.totalStorageBytes) : null,
    formatRelativeTime(asset.createdAt),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * All-time plays (B-09). The sdk adds `playCount` with the backend items;
 * until a server sends it the column shows an en dash instead of a 0 that
 * would claim nobody watched.
 */
export function playsOf(asset: VideoAsset): number | undefined {
  const n = (asset as Partial<{ playCount: number }>).playCount;
  return typeof n === 'number' ? n : undefined;
}
