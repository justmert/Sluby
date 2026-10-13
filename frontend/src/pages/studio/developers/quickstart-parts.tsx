import { Link } from 'react-router';
import { LoadingHead } from '@/components/developers/LoadingHead';
import { VideoPickerSkeleton } from '@/components/developers/VideoPickerSkeleton';
import { PageHeader } from '@/components/shared/PageHeader';
import { CopyButton } from '@/components/shared/CopyButton';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PAGE_HEADS } from '@/components/layout/page-heads';
import { ROUTES } from '@/lib/constants';
import { API_REFERENCE_URL } from '@/lib/embed';
import { lateReveal } from '@/lib/motion';
import { preloadPage } from '@/lib/page-chunks';
import { cn } from '@/lib/utils';
import { KeyNote } from './KeyNote';
import {
  QUICKSTART_DESCRIPTION,
  SMALL_BUTTON,
  STEP_TITLES,
  stepHeadingId,
} from './quickstart-copy';

// the quickstart's fixed pieces, in their own module (like KeyNote) so the
// route skeleton draws the same cards, rows and text without loading the page

/**
 * The page's title block and its width: the four steps read as one column.
 * The route skeleton passes `loading`, so its title is not a second h1.
 */
export function QuickstartFrame({
  children,
  loading = false,
}: {
  children: React.ReactNode;
  loading?: boolean;
}) {
  const Head = loading ? LoadingHead : PageHeader;
  return (
    <div className="flex w-full flex-col">
      <Head {...PAGE_HEADS.quickstart} description={QUICKSTART_DESCRIPTION} />
      <ol className="flex flex-col gap-5">{children}</ol>
    </div>
  );
}

/**
 * One numbered step: an outlined number beside its heading and body. The
 * steps are an ordered list, so a screen reader hears "1 of 4" without the
 * number being read twice.
 */
export function StepCard({
  n,
  children,
  actions,
  bodyClassName,
}: {
  /** 1 to 4; the title comes from STEP_TITLES */
  n: number;
  children: React.ReactNode;
  /** buttons at the end of a one-line step, beside its heading and text; they wrap under on a phone */
  actions?: React.ReactNode;
  bodyClassName?: string;
}) {
  const heading = (
    <h2 id={stepHeadingId(n)} className="font-heading text-heading">
      {STEP_TITLES[n - 1]}
    </h2>
  );
  return (
    <li className="flex gap-4 rounded-xl border bg-card px-6 py-5 text-sm max-sm:px-4">
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] border-foreground text-[13px] font-bold tabular-nums"
      >
        {n}
      </span>
      {actions ? (
        <section
          aria-labelledby={stepHeadingId(n)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-3"
        >
          <div className="flex-[1_1_280px]">
            {heading}
            {children}
          </div>
          {actions}
        </section>
      ) : (
        <section
          aria-labelledby={stepHeadingId(n)}
          className={cn('flex min-w-0 flex-1 flex-col gap-3', bodyClassName)}
        >
          {heading}
          {children}
        </section>
      )}
    </li>
  );
}

/** A row of the Your API grid: its label beside its value, or above it on a phone. */
export function ServerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 @lg/page:grid-cols-[120px_minmax(0,1fr)] @lg/page:items-center @lg/page:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

/** The base URL in a mono box with its Copy button. */
export function BaseUrl({ value }: { value: string }) {
  return (
    <>
      <span className="min-w-0 rounded-lg border px-2.5 py-1.5 font-mono text-sm leading-5 wrap-anywhere">
        {value}
      </span>
      <CopyButton
        value={value}
        label="Copy base URL"
        withText
        variant="outline"
        className={SMALL_BUTTON}
      />
    </>
  );
}

/** The keys row: how many keys there are (or a bar while that loads), then where to manage them. */
export function KeysRow({ count }: { count: React.ReactNode }) {
  return (
    <>
      {/* its own line on narrow pages, so the buttons stay on one line
          whether the count is a bar, "No active keys yet" or an error */}
      <span className="@max-lg/page:basis-full">{count}</span>
      <Button variant="outline" className={SMALL_BUTTON} asChild>
        <Link to={ROUTES.API_KEYS} onPointerEnter={() => preloadPage(ROUTES.API_KEYS)}>
          Manage keys
        </Link>
      </Button>
      <Button className={SMALL_BUTTON} asChild>
        <Link
          to={`${ROUTES.API_KEYS}?create=key`}
          onPointerEnter={() => preloadPage(ROUTES.API_KEYS)}
        >
          Create key
        </Link>
      </Button>
    </>
  );
}

/** The keys count while it loads. */
export function KeysCountLoading() {
  return <Skeleton as="span" className={cn('inline-block h-4 w-24 align-middle', lateReveal)} />;
}

/** The API reference, as a button that opens in a new tab. */
export function ReferenceLinks() {
  return (
    <Button variant="outline" asChild>
      <a href={API_REFERENCE_URL} target="_blank" rel="noopener noreferrer">
        API reference
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </Button>
  );
}

export function TryExplorerLink() {
  return (
    <Button variant="outline" asChild>
      <Link to={ROUTES.EXPLORER} onPointerEnter={() => preloadPage(ROUTES.EXPLORER)}>
        Open the API explorer
      </Link>
    </Button>
  );
}

/** Step 2's rows and note, with the keys count the page fills in. */
export function ApiStep({ count }: { count: React.ReactNode }) {
  return (
    <StepCard n={2}>
      <dl className="flex flex-col gap-2.5">
        <ServerRow label="Base URL">
          <BaseUrl value={window.location.origin} />
        </ServerRow>
        <ServerRow label="API key">
          <KeysRow count={count} />
        </ServerRow>
      </dl>
      <KeyNote />
    </StepCard>
  );
}

/** Step 4: the explorer and the reference. */
export function TryStep() {
  return (
    <StepCard
      n={4}
      actions={
        <>
          <TryExplorerLink />
          <ReferenceLinks />
        </>
      }
    >
      <p className="mt-1 text-muted-foreground">Send real calls to your API from the browser.</p>
    </StepCard>
  );
}

/**
 * The page as it first draws while its code and data load: the same cards,
 * with bars where the videos, the keys count and the snippet wait.
 */
export function QuickstartLoading() {
  return (
    <QuickstartFrame loading>
      <StepCard n={1} bodyClassName="gap-2.5">
        <VideoPickerSkeleton />
      </StepCard>
      <ApiStep count={<KeysCountLoading />} />
      <StepCard n={3}>
        <Skeleton className={cn('h-9 w-full max-w-[460px] rounded-[9px]', lateReveal)} />
        <Skeleton className={cn('h-5 w-3/4', lateReveal)} />
        <Skeleton className={cn('h-56 rounded-[10px]', lateReveal)} />
      </StepCard>
      <TryStep />
    </QuickstartFrame>
  );
}
