import type { VideoAsset } from '@sluby/sdk';
import {
  failureInfo,
  jobSummary,
  processingView,
  type FailureInfo,
} from '@/components/asset/processing';
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
  /** work is running right now, so its bar shows the moving sheen */
  moving: boolean;
}

export interface RowJob {
  /** a processing video: where it is, polled while it is on screen */
  progress?: RowProgress;
  /** a failed video: why, and whether a retry can help (FLW-21, FLW-22) */
  failure?: FailureInfo;
  /** a failed video whose reason is still loading; rows hold its line open */
  failurePending?: boolean;
  /** a processing video whose stage is still loading; rows hold its line open */
  progressPending?: boolean;
}

/**
 * The processing job behind a row, for the two statuses that have something
 * to say: processing (stage and percent) and failed (the reason). A failed
 * job is read once; it does not change by asking again.
 */
export function useRowJob(asset: VideoAsset): RowJob {
  const processing = asset.status === 'processing';
  const failed = asset.status === 'failed';
  const job = useProcessingJob(asset.id, asset.status, processing || failed, ROW_POLL_MS);
  if (processing && job.data) {
    const view = processingView(job.data);
    return {
      progress: {
        label: jobSummary(job.data),
        percent: view.percent,
        checking: job.isError,
        moving: view.busy && !job.isError,
      },
    };
  }
  // a failed video whose job is gone (404) still gets the generic reason
  if (failed && (job.data || job.isError)) return { failure: failureInfo(job.data, asset) };
  if (processing) return { progressPending: true };
  return failed ? { failurePending: true } : {};
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
