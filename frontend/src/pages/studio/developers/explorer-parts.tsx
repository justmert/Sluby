import { ExternalLink } from 'lucide-react';
import { LoadingHead } from '@/components/developers/LoadingHead';
import { PAGE_HEADS } from '@/components/layout/page-heads';
import { Skeleton } from '@/components/ui/skeleton';
import { API_REFERENCE_URL } from '@/lib/embed';
import { cn } from '@/lib/utils';
import {
  EXPLORER_CARD,
  EXPLORER_GRID,
  EXPLORER_ROW,
  EXPLORER_SEND,
  EXPLORER_TEMPLATE,
} from './quickstart-copy';

// the explorer's fixed pieces, in their own module so the route skeleton
// draws the same cards and text without loading the page

/** The request card's heading and the line under it. */
export function RequestIntro() {
  return (
    <div className="flex flex-col gap-1">
      <h2 id="explorer-request" className="font-heading text-heading">
        Request
      </h2>
      <p className="text-muted-foreground">
        Sent with your session, so it can change real data. See the{' '}
        <a
          href={API_REFERENCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          API reference
          <ExternalLink aria-hidden="true" className="size-3" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>{' '}
        for every endpoint.
      </p>
    </div>
  );
}

/** What the response card says before anything was sent. */
export function NoAnswerYet({ sending = false }: { sending?: boolean }) {
  return (
    <p className="rounded-[10px] border border-dashed px-4 py-10 text-center text-muted-foreground">
      {sending ? 'Waiting for the answer…' : 'Send a request to see the answer here.'}
    </p>
  );
}

// the label of a field (ui/label), without the label code
const LABEL = 'flex items-center gap-2 text-sm leading-5 font-medium';
// a select, a field or Send: 36 px, a finger's 40 on touch
const CONTROL = 'h-9 pointer-coarse:h-10';

/** The explorer as it first draws: its cards and words, with bars for the controls. */
export function ExplorerLoading() {
  return (
    <>
      <LoadingHead {...PAGE_HEADS.explorer} />
      <div className={EXPLORER_GRID}>
        <div className={EXPLORER_CARD}>
          <RequestIntro />
          <div className="flex flex-col gap-4">
            <div className={EXPLORER_ROW}>
              <div className={EXPLORER_TEMPLATE}>
                <div className={LABEL}>Template</div>
                <Skeleton className={CONTROL} />
              </div>
              <div className="grid gap-2">
                <div className={LABEL}>Method</div>
                <Skeleton className={CONTROL} />
              </div>
              <div className="grid min-w-0 gap-2">
                <div className={LABEL}>Path</div>
                <Skeleton className={CONTROL} />
              </div>
              <Skeleton className={cn(CONTROL, EXPLORER_SEND, '@lg/page:w-24')} />
            </div>
          </div>
        </div>
        <div className={EXPLORER_CARD}>
          <h2 className="font-heading text-heading">Response</h2>
          <div className="flex min-w-0 flex-col gap-3">
            <NoAnswerYet />
          </div>
        </div>
      </div>
    </>
  );
}
