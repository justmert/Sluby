import { useState } from 'react';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { Collapse } from '@/components/motion/Collapse';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { describeError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { ErrorDetails } from './ErrorDetails';

export interface InlineErrorProps {
  /** the error, or null/undefined when there is none; the block eases open and shut */
  error: unknown;
  /** what failed to load, finishing "Could not load ...": "your API keys" */
  what?: string;
  /** a full lead sentence instead of "Could not load {what}": "Could not create the key" */
  title?: string;
  /** shows Try again when the error is worth retrying, e.g. query.refetch */
  onRetry?: () => unknown;
  /** the retry is running: the button spins and is disabled */
  retrying?: boolean;
  /** a sentence after the message, e.g. "Showing the last figures that loaded." */
  note?: string;
  className?: string;
}

/**
 * The one error block for anything smaller than a page: a card that could
 * not load, a dialog whose save failed, a tab. It says what failed in the
 * title, what happened and what to do from lib/errors.ts, folds the raw
 * message under Details, and offers Try again when retrying can help.
 *
 *   <InlineError what="your API keys" error={keys.error} onRetry={keys.refetch} retrying={keys.isFetching} />
 *   <InlineError title="Could not create the key" error={create.error} />
 *
 * It animates its own height in and out (Collapse), so a dialog grows
 * smoothly instead of jumping, and it keeps showing the last error while it
 * closes.
 */
export function InlineError({
  error,
  what,
  title,
  onRetry,
  retrying = false,
  note,
  className,
}: InlineErrorProps) {
  const present = error != null && error !== false;
  // keep the last error on screen while the block collapses
  const [shown, setShown] = useState<unknown>(error);
  if (present && !Object.is(shown, error)) setShown(error);
  const info = describeError(present ? error : shown);
  const heading = title ?? (what ? `Could not load ${what}` : 'Something went wrong');
  const canRetry = onRetry && (info.action === 'retry' || info.action === 'wait');

  return (
    <Collapse open={present}>
      <div
        role="alert"
        data-slot="inline-error"
        className={cn(
          'grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm',
          className,
        )}
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 text-destructive" />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{heading}</p>
          <p className="mt-0.5 text-muted-foreground">
            {info.message}
            {note && ` ${note}`}
          </p>
          {/* the raw text only adds something when it differs from the sentence */}
          <ErrorDetails
            detail={info.detail !== info.message ? info.detail : undefined}
            className="mt-1.5"
          />
        </div>
        {canRetry && (
          <div className="col-start-2 mt-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onRetry()}
              disabled={retrying}
            >
              {retrying ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <RotateCcw />}
              {retrying ? 'Trying again…' : 'Try again'}
            </Button>
          </div>
        )}
      </div>
    </Collapse>
  );
}
