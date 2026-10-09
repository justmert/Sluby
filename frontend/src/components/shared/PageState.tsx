import type { ReactNode } from 'react';
import * as m from 'motion/react-m';
import { CircleAlert, RotateCcw, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { describeError } from '@/lib/errors';
import { fadeUp, scaleIn } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ErrorDetails } from './ErrorDetails';

interface PageStateProps {
  /** defaults to an alert icon when `error` is given */
  icon?: LucideIcon;
  title: string;
  /** one or two sentences; with `error` it defaults to the error's sentence */
  description?: ReactNode;
  /** the raw text behind the state, folded under Details; with `error` it defaults to the raw message */
  detail?: string;
  /** buttons or links for the way out; secondary first, primary last */
  actions?: ReactNode;
  /** `error` tints the icon; set for you when `error` is given */
  tone?: 'default' | 'error';
  /** the error behind a whole-page failure; its words come from lib/errors.ts */
  error?: unknown;
  /** adds Try again (primary, last) when the error is worth retrying */
  onRetry?: () => unknown;
  retrying?: boolean;
}

/**
 * A whole-page state with no page behind it: not found (the route or a
 * record), a page that could not load, or a page that crashed. Vertically
 * centred in the content area, with the title as the page's h1. For anything
 * smaller than a page, use InlineError or EmptyState.
 *
 *   <PageState title="Could not load this video" error={query.error} onRetry={query.refetch}
 *     actions={<Button variant="outline" asChild><Link to="/studio/videos">Back to videos</Link></Button>} />
 */
export function PageState({
  icon,
  title,
  description,
  detail,
  actions,
  tone,
  error,
  onRetry,
  retrying = false,
}: PageStateProps) {
  const info = error === undefined ? undefined : describeError(error);
  const Icon = icon ?? (info ? CircleAlert : undefined);
  const errorTone = (tone ?? (info ? 'error' : 'default')) === 'error';
  const canRetry = onRetry && info && (info.action === 'retry' || info.action === 'wait');
  return (
    <m.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      data-slot="page-state"
      className="flex min-h-[60vh]"
    >
      <Empty>
        <EmptyHeader>
          {Icon && (
            <m.div variants={scaleIn}>
              <EmptyMedia variant="icon" className="size-10 rounded-xl">
                <Icon className={cn('size-5', errorTone && 'text-destructive')} />
              </EmptyMedia>
            </m.div>
          )}
          <EmptyTitle role="heading" aria-level={1}>
            {title}
          </EmptyTitle>
          <EmptyDescription>{description ?? info?.message}</EmptyDescription>
          <ErrorDetails detail={detail ?? info?.detail} className="mt-1" />
        </EmptyHeader>
        {(actions || canRetry) && (
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            {actions}
            {canRetry && (
              <Button onClick={() => void onRetry()} disabled={retrying}>
                {retrying ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <RotateCcw />}
                {retrying ? 'Trying again…' : 'Try again'}
              </Button>
            )}
          </EmptyContent>
        )}
      </Empty>
    </m.div>
  );
}
