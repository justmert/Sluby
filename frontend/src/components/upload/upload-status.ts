import { processingView } from '@/components/asset/processing';
import { formatBytes, formatUptime } from '@/lib/formatters';
import type { UploadState } from '@/lib/upload-store';

/*
 * one status line per upload row (copy.md P5): the badge already names the
 * phase, so the line only says what is new, such as
 * "5.4 of 12 MB · 220 KB/s · about 30 s left". the bar beside it carries the
 * percent, so the line leaves it out.
 */

// speed over the first moments of a transfer swings too much to promise a time
const TIME_LEFT_AFTER_MS = 3_000;

/** A rough time left: precise seconds would only flicker. */
export function timeLeft(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 10) return 'a few seconds left';
  if (s < 60) return `about ${Math.max(10, Math.round(s / 5) * 5)} s left`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  return `about ${formatUptime(minutes * 60_000)} left`;
}

/** How long sending took: "12 seconds", "3 minutes". */
export function timeSpent(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  return formatUptime(ms);
}

/** The percent of the file sent, 0 to 100. */
export function sentPercent(u: Pick<UploadState, 'bytesUploaded' | 'bytesTotal'>): number {
  if (u.bytesTotal <= 0) return 100;
  return Math.min(100, (u.bytesUploaded / u.bytesTotal) * 100);
}

/** "5.4 of 12 MB": one unit when both share it, otherwise both spelled out. */
export function sentOf(sent: number, total: number): string {
  const a = formatBytes(sent);
  const b = formatBytes(total);
  const unitA = a.split(' ')[1];
  const unitB = b.split(' ')[1];
  return unitA === unitB ? `${a.split(' ')[0]} of ${b}` : `${a} of ${b}`;
}

export interface StatusLine {
  /** the line itself */
  text: string;
  /** a muted second line, such as the Sia wait or "Checking again in a few seconds." */
  detail: string | null;
  /** red for a failure, muted otherwise */
  tone: 'muted' | 'danger';
  /** 0 to 100 for a bar, null for no bar, 'waiting' for a bar with no number yet */
  bar: number | 'waiting' | null;
}

const line = (text: string, more: Partial<StatusLine> = {}): StatusLine => ({
  text,
  detail: null,
  tone: 'muted',
  bar: null,
  ...more,
});

export function statusLine(u: UploadState): StatusLine {
  switch (u.phase) {
    case 'uploading': {
      const percent = sentPercent(u);
      const parts = [sentOf(u.bytesUploaded, u.bytesTotal)];
      if (u.speed > 0 && u.activeMs >= TIME_LEFT_AFTER_MS) {
        parts.push(`${formatBytes(u.speed)}/s`);
        parts.push(timeLeft(((u.bytesTotal - u.bytesUploaded) / u.speed) * 1000));
      }
      return line(parts.join(' · '), { bar: percent });
    }
    case 'paused': {
      const percent = sentPercent(u);
      return line(`${Math.floor(percent)}% · ${sentOf(u.bytesUploaded, u.bytesTotal)} sent`, {
        bar: percent,
      });
    }
    case 'finishing':
      return line('File sent. Waiting for the server to confirm.', { bar: 'waiting' });
    case 'processing': {
      const checking = u.checking ? 'Checking again in a few seconds.' : null;
      if (u.pollStopped && u.error) return line(u.error, { tone: 'danger' });
      if (!u.job) return line('Waiting to start', { bar: 'waiting', detail: checking });
      const view = processingView(u.job);
      const attempt = u.attempt ? ` (attempt ${u.attempt.n} of ${u.attempt.of})` : '';
      const text =
        view.percent !== null && view.busy && u.job.status !== 'retrying'
          ? `${view.label}, ${view.percent}%`
          : `${view.label}${attempt}`;
      return line(text, {
        detail: checking ?? view.detail,
        bar: view.percent ?? 'waiting',
      });
    }
    case 'ready':
      return line(
        u.activeMs > 0
          ? `Uploaded ${formatBytes(u.bytesTotal)} in ${timeSpent(u.activeMs)}`
          : `Uploaded ${formatBytes(u.bytesTotal)}`,
      );
    case 'failed':
      // a dropped connection is not the upload's fault, and it goes on by itself
      // neither is the upload's fault: the connection goes on by itself, and a
      // video deleted elsewhere was someone's choice
      return line(u.error ?? 'The upload failed.', {
        tone: u.lostConnection || u.assetGone ? 'muted' : 'danger',
      });
    case 'cancelled':
      if (u.cleanup === 'pending') return line('Canceling…');
      if (u.cleanup === 'failed') {
        return line(u.error ?? 'The server did not confirm it removed the partial file.', {
          tone: 'danger',
        });
      }
      return line(
        u.cleanup === 'nothing'
          ? 'Upload canceled before it reached the server.'
          : 'Upload canceled. Nothing was kept.',
      );
  }
}

/** The short form for the top bar tray and the accessible name of its button. */
export function shortStatus(u: UploadState): string {
  switch (u.phase) {
    case 'uploading':
      return `Uploading, ${Math.floor(sentPercent(u))}%`;
    case 'paused':
      return `Paused at ${Math.floor(sentPercent(u))}%`;
    case 'finishing':
      return 'Finishing the upload';
    case 'processing':
      return u.job ? statusLine(u).text : 'Waiting to start';
    case 'ready':
      return 'Ready';
    case 'failed':
      return u.assetGone ? 'Deleted' : 'Failed';
    case 'cancelled':
      return 'Canceled';
  }
}

/** The badge an upload row shows: its phase, unless it ended for a reason that is not a failure. */
export function badgeStatus(u: UploadState): UploadState['phase'] | 'offline' | 'deleted' {
  if (u.phase !== 'failed') return u.phase;
  if (u.lostConnection) return 'offline';
  return u.assetGone ? 'deleted' : 'failed';
}

/** What the toast and the screen reader say when an upload ends without a video. */
export function endedText(u: UploadState): string {
  if (u.assetGone) return `“${u.title}” was deleted before processing finished.`;
  return `“${u.title}” failed. ${u.error ?? ''}`.trim();
}
