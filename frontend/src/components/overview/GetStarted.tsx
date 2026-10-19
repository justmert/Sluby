import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { processingView } from '@/components/asset/processing';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import type { SystemStatus } from '@/hooks/useStats';
import { ROUTES } from '@/lib/constants';
import { formatCount } from '@/lib/formatters';
import { scaleIn } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { doneCount, REQUIRED_STEPS, type StepId, type StepState } from './get-started';

interface GetStartedProps {
  steps: StepState[];
  admin: boolean;
  status?: SystemStatus;
  /** the newest video still uploading or processing, for step 2's progress line */
  busy?: VideoAsset;
  /** how many videos are ready, for step 2's done line */
  readyCount?: number;
  /** a ready video for the embed code step; null when there is none */
  firstReady: VideoAsset | null | undefined;
  onDismiss: () => void;
}

const TITLE: Record<StepId, string> = {
  sia: 'Connect Sia',
  upload: 'Upload a video',
  play: 'Play it on your site',
  key: 'Create an API key',
};

type Mark = 'done' | 'failing' | 'current' | 'todo';

// the design's marks: a green tick when done, a hollow ring otherwise, petrol
// on the step to do next. a failing step gets a red ring with a bar through it
function StepMark({ mark }: { mark: Mark }) {
  return (
    <span className="relative grid size-4.5 shrink-0 place-items-center" aria-hidden="true">
      {/* the new mark scales in over the old one; the tile itself stays put */}
      <AnimatePresence initial={false}>
        <m.span
          key={mark}
          variants={scaleIn}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="col-start-1 row-start-1 grid place-items-center"
        >
          {mark === 'done' ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              className="size-4.5 text-success"
            >
              <path d="M5 12l5 5 9-10" />
            </svg>
          ) : mark === 'failing' ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="size-4.5 text-destructive"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
          ) : (
            <span
              className={cn(
                'size-4.5 rounded-full border-2',
                mark === 'current' ? 'border-primary' : 'border-border-strong',
              )}
            />
          )}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

function UploadProgressLine({ video }: { video: VideoAsset }) {
  const job = useProcessingJob(video.id, video.status, video.status === 'processing', 5_000);
  const view = job.data ? processingView(job.data) : null;
  const what = video.status === 'uploading' ? 'Uploading' : (view?.label ?? 'Processing');
  return (
    <span className="tabular-nums">
      {what} <span dir="auto">“{video.title}”</span>
      {view?.percent != null && video.status === 'processing' && `, ${view.percent}%`}
    </span>
  );
}

// the tile's action is a plain petrol link, like the artboard's "Get embed code"
const ACTION =
  'h-auto self-start p-0 font-semibold no-underline hover:no-underline pointer-coarse:h-auto';

function Tile({
  step,
  mark,
  line,
  action,
  extra,
}: {
  step: StepState;
  mark: Mark;
  /** what shows under the title: the why, or what is happening */
  line: ReactNode;
  action?: ReactNode;
  extra?: ReactNode;
}) {
  const current = mark === 'current' || mark === 'failing';
  return (
    <li
      data-current={current || undefined}
      // the step to do next gets a 2px edge; its padding gives back the
      // extra pixel so the tile's content does not move
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border p-3.5',
        current && 'border-2 p-[13px]',
        mark === 'current' && 'border-primary',
        mark === 'failing' && 'border-destructive',
      )}
    >
      <p className="flex items-center gap-2 font-semibold">
        <StepMark mark={mark} />
        {TITLE[step.id]}
        <span className="sr-only">, {step.done ? 'Done' : 'Not done'}</span>
      </p>
      {line && <p className="text-muted-foreground">{line}</p>}
      {extra}
      {action}
    </li>
  );
}

/**
 * The first-run checklist on Overview (D-10, D-31): four steps, each ticking
 * itself from live data, the one to do next outlined in petrol with the
 * action that does it.
 */
export function GetStarted({
  steps,
  admin,
  status,
  busy,
  readyCount,
  firstReady,
  onDismiss,
}: GetStartedProps) {
  const n = doneCount(steps);
  const by = Object.fromEntries(steps.map((s) => [s.id, s])) as Record<StepId, StepState>;

  // step 1 is failing when the server answered and the indexer did not, or its account is not ready
  const siaFailing = !!status && !by.sia.done;
  const indexerDown = !!status && !status.indexer.ok;
  const probeError =
    status?.scope === 'deployment' && !status.indexer.ok ? status.indexer.error : undefined;

  // the step to do next: the first one not done yet
  const next = steps.find((s) => !s.done)?.id;
  const markOf = (id: StepId): Mark =>
    by[id].done
      ? 'done'
      : id === 'sia' && siaFailing
        ? 'failing'
        : next === id
          ? 'current'
          : 'todo';

  return (
    <Card
      aria-labelledby="get-started"
      role="region"
      className="gap-4 px-6 py-5 text-sm shadow-none"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="get-started" className="font-heading text-heading">
          Get started
        </h2>
        <span className="text-muted-foreground tabular-nums">
          {n} of {REQUIRED_STEPS} done
        </span>
        <Progress
          value={(n / REQUIRED_STEPS) * 100}
          aria-label="Get started progress"
          className="w-auto max-w-50 min-w-20 flex-1 bg-muted"
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Hide get started"
          onClick={onDismiss}
          className="ml-auto text-muted-foreground"
        >
          Hide
        </Button>
      </div>
      <ol
        aria-label="Steps"
        // tiles of at least 200px, as many to a row as fit
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-3"
      >
        <Tile
          step={by.sia}
          mark={markOf('sia')}
          line={
            by.sia.done
              ? 'Storage account ready.'
              : siaFailing
                ? indexerDown
                  ? 'This server cannot reach the Sia indexer.'
                  : 'The Sia account is not ready yet.'
                : 'Videos are stored on Sia, so this server needs a working Sia account.'
          }
          extra={siaFailing && <ErrorDetails detail={probeError} />}
          action={
            siaFailing &&
            (admin ? (
              <Button variant="link" className={ACTION} asChild>
                <Link to={ROUTES.DEPLOYMENT}>Open health</Link>
              </Button>
            ) : (
              <p className="text-muted-foreground">Ask an admin.</p>
            ))
          }
        />
        <Tile
          step={by.upload}
          mark={markOf('upload')}
          line={
            busy ? (
              <UploadProgressLine video={busy} />
            ) : by.upload.done ? (
              readyCount === undefined ? null : readyCount === 1 ? (
                '1 video ready to play.'
              ) : (
                `${formatCount(readyCount)} videos ready to play.`
              )
            ) : (
              'It is ready to stream in a few minutes.'
            )
          }
          action={
            !by.upload.done && (
              <Button variant="link" className={ACTION} asChild>
                <Link to={ROUTES.UPLOAD}>Upload video</Link>
              </Button>
            )
          }
        />
        <Tile
          step={by.play}
          mark={markOf('play')}
          line={
            by.play.done
              ? 'A player loaded one of your videos.'
              : firstReady
                ? 'Paste the embed code. Studio previews do not count.'
                : 'Available once a video is ready.'
          }
          action={
            !by.play.done &&
            (firstReady ? (
              <Button variant="link" className={ACTION} asChild>
                <Link to={`${ROUTES.video(firstReady.id)}?tab=share`}>Get embed code</Link>
              </Button>
            ) : (
              <Button variant="link" className={ACTION} disabled>
                Get embed code
              </Button>
            ))
          }
        />
        <Tile
          step={by.key}
          mark={markOf('key')}
          line={by.key.done ? 'Your server can call the API.' : 'Optional, for your server.'}
          action={
            !by.key.done && (
              <Button variant="link" className={ACTION} asChild>
                <Link to={`${ROUTES.API_KEYS}?create=key`}>Create key</Link>
              </Button>
            )
          }
        />
      </ol>
    </Card>
  );
}
