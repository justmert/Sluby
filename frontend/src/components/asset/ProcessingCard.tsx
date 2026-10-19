import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CircleAlert, CirclePause, Upload } from 'lucide-react';
import type { VideoAsset } from '@sluby/sdk';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/constants';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { assetSteps } from './pipeline-states';
import { PipelineProgress } from './PipelineProgress';
import { failureInfo, processingView, type Job } from './processing';
import { RetryProcessingButton } from './RetryProcessingButton';

export interface ProcessingCardProps {
  asset: Pick<VideoAsset, 'id' | 'title' | 'status'>;
  /** The processing job as last read; undefined before the first answer or when there is none. */
  job: Job | undefined;
  /** The last read of the job failed (FLW-11). */
  jobError: boolean;
  /** Reading the job again is under way. */
  checking: boolean;
  onCheckAgain: () => void;
  /** The upload stopped arriving (isInterrupted). */
  interrupted: boolean;
  /** Opens the page's delete confirmation. */
  onDelete: () => void;
  className?: string;
}

function Frame({
  icon,
  title,
  children,
  actions,
  steps,
  tone = 'default',
  className,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  steps: ReactNode;
  tone?: 'default' | 'danger' | 'warning';
  className?: string;
}) {
  return (
    <section
      aria-labelledby="processing-card-title"
      data-slot="processing-card"
      data-tone={tone}
      className={cn(
        'flex aspect-video min-h-64 w-full flex-col justify-center rounded-xl border bg-card p-5 shadow-xs max-sm:aspect-auto sm:p-8 dark:shadow-none',
        // the card fills the player's box, so the page does not jump when it turns into the player.
        // on phones the stacked actions need more height than a 16:9 box has, so it grows
        className,
      )}
    >
      {/* a centred column: stretched across the whole player box, the bar and
          the steps ran edge to edge with empty space above and below */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <div className="flex items-start gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 id="processing-card-title" className="font-heading text-heading">
              {title}
            </h2>
            <div className="mt-1 text-sm text-muted-foreground">{children}</div>
          </div>
        </div>
        {steps}
        {/* full width on phones, so two actions are not two ragged rows */}
        {actions && (
          <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col max-sm:items-stretch">
            {actions}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * What the player box shows before a video can play: the processing steps
 * and progress, a failure with the one action that helps, or an upload that
 * stopped. Status read errors say so instead of guessing a step.
 */
export function ProcessingCard({
  asset,
  job,
  jobError,
  checking,
  onCheckAgain,
  interrupted,
  onDelete,
  className,
}: ProcessingCardProps) {
  const deleteButton = (
    <Button
      variant="outline"
      className="h-auto min-h-8 py-1.5 whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-10"
      onClick={onDelete}
    >
      <Icons.delete />
      Delete video
    </Button>
  );

  if (interrupted) {
    return (
      <Frame
        className={className}
        tone="warning"
        icon={
          <CirclePause
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-warning-foreground"
          />
        }
        title="Upload interrupted"
        actions={deleteButton}
        steps={
          <PipelineProgress
            steps={assetSteps(asset, job, { interrupted: true })}
            label={`${asset.title}, processing progress`}
          />
        }
      >
        <p>
          The browser sending this file stopped. Add the same file again in that browser to
          continue, or delete this video. Unfinished uploads are removed after 24 hours.
        </p>
      </Frame>
    );
  }

  // the job is the fresher signal: it moves first when a retry starts
  const failed = job ? job.status === 'failed' : asset.status === 'failed';
  if (failed) {
    const info = failureInfo(job, { status: 'failed' });
    return (
      <Frame
        className={className}
        tone="danger"
        icon={
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
        }
        title={info.title}
        steps={
          <PipelineProgress
            steps={assetSteps(asset, job)}
            label={`${asset.title}, processing progress`}
          />
        }
        actions={
          <>
            {deleteButton}
            {/* outline on an error card: red is already there, a filled warm button would blur into it (VIS-11) */}
            {info.action === 'retry' && <RetryProcessingButton asset={asset} variant="outline" />}
            {info.action === 'reupload' && (
              // wraps at a large text size instead of running out of the card
              <Button
                variant="outline"
                className="h-auto min-h-8 py-1.5 whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-10"
                asChild
              >
                <Link to={ROUTES.UPLOAD}>
                  <Upload />
                  Upload a different file
                </Link>
              </Button>
            )}
          </>
        }
      >
        <p>{info.body}</p>
        <ErrorDetails detail={info.detail ?? 'No details were recorded.'} className="mt-2" />
      </Frame>
    );
  }

  const uploading = asset.status === 'created' || asset.status === 'uploading';
  const view = job && !uploading ? processingView(job) : null;
  const label = uploading
    ? 'Waiting for the upload to finish'
    : view
      ? view.label
      : jobError
        ? 'Could not read the processing status.'
        : 'Checking the processing status…';

  return (
    <Frame
      className={className}
      title={uploading ? 'Uploading' : 'Processing'}
      steps={
        <PipelineProgress
          steps={assetSteps(asset, job)}
          percent={view?.percent ?? null}
          moving={Boolean(view?.busy) && !jobError}
          label={`${asset.title}, processing progress`}
        />
      }
      actions={
        jobError && !uploading ? (
          <Button variant="outline" onClick={onCheckAgain} disabled={checking}>
            <Icons.refresh className={cn(checking && 'motion-safe:animate-spin')} />
            Check again
          </Button>
        ) : undefined
      }
    >
      <div className="flex items-baseline justify-between gap-3" aria-live="polite">
        <p className="text-foreground">
          {label}
          {view?.detail && <span className="block text-muted-foreground">{view.detail}</span>}
          {jobError && view && (
            <span className="block text-muted-foreground">
              Could not read the processing status. Showing the last one that loaded.
            </span>
          )}
        </p>
        {view?.percent != null && (
          <span className="font-heading text-figure-sm text-foreground tabular-nums">
            {view.percent}%
          </span>
        )}
      </div>
    </Frame>
  );
}
