import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Circle, CircleAlert, CircleCheck, X } from 'lucide-react';
import { processingView } from '@/components/asset/processing';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import type { SystemStatus } from '@/hooks/useStats';
import { ROUTES } from '@/lib/constants';
import { Icons } from '@/lib/icons';
import { scaleIn } from '@/lib/motion';
import { useUploadSheet } from '@/lib/upload-sheet';
import { doneCount, REQUIRED_STEPS, type StepId, type StepState } from './get-started';

interface GetStartedProps {
  steps: StepState[];
  operator: boolean;
  status?: SystemStatus;
  /** the newest video still uploading or processing, for step 2's progress line */
  busy?: VideoAsset;
  /** a ready video for the embed code step; null when there is none */
  firstReady: VideoAsset | null | undefined;
  onDismiss: () => void;
}

const COPY: Record<StepId, { title: string; why: string }> = {
  sia: {
    title: 'Connect Sia storage',
    why: 'Videos are stored on Sia, so this server needs a working Sia account.',
  },
  upload: { title: 'Upload a video', why: 'It is ready to stream in a few minutes.' },
  play: {
    title: 'Play it on your site',
    why: 'Copy the embed code for a ready video. This ticks when a player on your site loads it; previews in the Studio do not count.',
  },
  key: {
    title: 'Create an API key',
    why: 'Your server uses it to upload videos and sign private ones.',
  },
  webhook: {
    title: 'Get told when videos are ready',
    why: 'Add a webhook so your server hears about new videos.',
  },
};

function StepIcon({ done, failing }: { done: boolean; failing: boolean }) {
  const state = done ? 'done' : failing ? 'failing' : 'todo';
  return (
    <span className="relative grid size-5 shrink-0 place-items-center" aria-hidden="true">
      {/* the new icon scales in over the old one; the row itself stays put */}
      <AnimatePresence initial={false}>
        <m.span
          key={state}
          variants={scaleIn}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="col-start-1 row-start-1"
        >
          {done ? (
            <CircleCheck className="size-5 text-success" />
          ) : failing ? (
            <CircleAlert className="size-5 text-destructive" />
          ) : (
            <Circle className="size-5 text-muted-foreground" />
          )}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

function UploadProgressLine({ video }: { video: VideoAsset }) {
  const job = useProcessingJob(video.id, video.status, video.status === 'processing', 5_000);
  const view = job.data ? processingView(job.data) : null;
  const what = video.status === 'uploading' ? 'Uploading' : 'Processing';
  return (
    <span className="tabular-nums">
      {what} <span dir="auto">“{video.title}”</span>
      {view?.percent != null && video.status === 'processing' && `, ${view.percent}%`}
    </span>
  );
}

function Row({
  step,
  failing,
  line,
  action,
  extra,
}: {
  step: StepState;
  failing: boolean;
  /** what shows under the title: the why, or what is happening */
  line: ReactNode;
  action?: ReactNode;
  extra?: ReactNode;
}) {
  const copy = COPY[step.id];
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3 py-3 first:pt-0 last:pb-0 @lg/started:grid-cols-[auto_1fr_auto] @lg/started:items-center">
      <StepIcon done={step.done} failing={failing} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
          {copy.title}
          {step.optional && <Badge variant="secondary">Optional</Badge>}
          <span className="sr-only">
            , {step.done ? 'Done' : step.optional ? 'Not done, optional' : 'Not done'}
          </span>
        </p>
        {line && <p className="text-sm text-muted-foreground">{line}</p>}
        {extra}
      </div>
      {action && (
        <div className="col-start-2 mt-2 @lg/started:col-start-3 @lg/started:mt-0">{action}</div>
      )}
    </li>
  );
}

/**
 * The first-run checklist on Overview (D-10, D-31): four steps and an
 * optional fifth, each ticking itself from live data, each with the action
 * that does it in place.
 */
export function GetStarted({
  steps,
  operator,
  status,
  busy,
  firstReady,
  onDismiss,
}: GetStartedProps) {
  const sheet = useUploadSheet();
  const n = doneCount(steps);
  const by = Object.fromEntries(steps.map((s) => [s.id, s])) as Record<StepId, StepState>;

  // step 1 is failing when the server answered and the indexer did not, or its account is not ready
  const siaFailing = !!status && !by.sia.done;
  const indexerDown = !!status && !status.indexer.ok;
  const probeError =
    status?.scope === 'deployment' && !status.indexer.ok ? status.indexer.error : undefined;

  return (
    <Card className="@container/started">
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription className="tabular-nums">
          {n} of {REQUIRED_STEPS} done
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Hide get started" onClick={onDismiss}>
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ol aria-label="Steps" className="flex flex-col divide-y">
          <Row
            step={by.sia}
            failing={siaFailing}
            line={
              by.sia.done && status
                ? `Connected to Sia ${status.indexer.network}`
                : siaFailing
                  ? indexerDown
                    ? 'This server cannot reach the Sia indexer.'
                    : 'The Sia account is not ready yet.'
                  : COPY.sia.why
            }
            extra={siaFailing && <ErrorDetails detail={probeError} className="mt-1" />}
            action={
              siaFailing &&
              (operator ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to={ROUTES.DEPLOYMENT}>Open health</Link>
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">Ask the operator of this server.</p>
              ))
            }
          />
          <Row
            step={by.upload}
            failing={false}
            line={
              busy ? <UploadProgressLine video={busy} /> : by.upload.done ? null : COPY.upload.why
            }
            action={
              !by.upload.done && (
                <Button variant="outline" size="sm" onClick={() => sheet.open()}>
                  <Icons.upload />
                  Upload video
                </Button>
              )
            }
          />
          <Row
            step={by.play}
            failing={false}
            line={
              by.play.done
                ? 'A player loaded one of your videos'
                : firstReady
                  ? COPY.play.why
                  : 'Available once a video is ready.'
            }
            action={
              !by.play.done &&
              (firstReady ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`${ROUTES.video(firstReady.id)}?panel=share`}>Get embed code</Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Get embed code
                </Button>
              ))
            }
          />
          <Row
            step={by.key}
            failing={false}
            line={by.key.done ? null : COPY.key.why}
            action={
              !by.key.done && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`${ROUTES.API_KEYS}?create=key`}>Create key</Link>
                </Button>
              )
            }
          />
          <Row
            step={by.webhook}
            failing={false}
            line={by.webhook.done ? null : COPY.webhook.why}
            action={
              !by.webhook.done && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`${ROUTES.WEBHOOKS}?create=webhook`}>Add webhook</Link>
                </Button>
              )
            }
          />
        </ol>
      </CardContent>
    </Card>
  );
}
