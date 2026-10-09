import { History } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { InlineError } from '@/components/shared/InlineError';
import { Skeleton } from '@/components/ui/skeleton';
import { errorStatus } from '@/hooks/asset-queries';
import { formatDate, plural } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { stageLabel, type Job } from './processing';

export interface ActivityTimelineProps {
  job: Job | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => unknown;
  retrying: boolean;
}

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * The processing log of a video: when, which step, and what happened, with
 * the line a run failed on in red. A focusable, named region, so a keyboard
 * can scroll a long log in every browser (A11Y-19).
 */
export function ActivityTimeline({
  job,
  isLoading,
  error,
  onRetry,
  retrying,
}: ActivityTimelineProps) {
  // a 404 means no job was ever made: an upload that never finished
  if (!job && errorStatus(error) === 404) {
    return (
      <EmptyState
        icon={History}
        title="Nothing has run yet"
        description="Processing starts once the whole file has arrived."
      />
    );
  }
  if (!job && error) {
    return (
      <InlineError what="the processing log" error={error} onRetry={onRetry} retrying={retrying} />
    );
  }
  if (!job) {
    return (
      <div className="flex flex-col gap-2" aria-busy={isLoading || undefined}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className={cn('h-5 w-full', lateReveal)} />
        ))}
      </div>
    );
  }

  const failedAt = job.status === 'failed' ? job.logs.length - 1 : -1;
  const facts = [
    job.startedAt && `Started ${formatDate(job.startedAt)}`,
    job.completedAt && `Finished ${formatDate(job.completedAt)}`,
    job.retryCount > 0 && `Tried again ${plural(job.retryCount, 'time')}`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      {error != null && (
        <InlineError
          what="the latest processing log"
          error={error}
          onRetry={onRetry}
          retrying={retrying}
        />
      )}
      {facts.length > 0 && (
        <p className="text-sm text-muted-foreground tabular-nums">{facts.join(' · ')}</p>
      )}
      {job.logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No details were recorded.</p>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label="Processing log"
          className="@container max-h-96 overflow-y-auto rounded-xl border bg-muted/40 p-3 font-mono text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <ol>
            {job.logs.map((line, i) => (
              <li
                key={i}
                data-failed={i === failedAt || undefined}
                className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 py-1 data-failed:text-destructive @md:grid-cols-[auto_8rem_1fr]"
              >
                <span className="text-muted-foreground tabular-nums">
                  <time dateTime={line.timestamp}>{time(line.timestamp)}</time>
                </span>
                <span className="text-muted-foreground">{stageLabel(line.stage)}</span>
                <span className="col-span-2 wrap-anywhere @md:col-span-1">{line.message}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
