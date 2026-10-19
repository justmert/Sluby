import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { CircleAlert } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { LINKS } from '@/lib/constants';
import { fadeUp, transition } from '@/lib/motion';
import { cn } from '@/lib/utils';

// a fast answer never shows the loading screen at all, so a signed-in
// reload goes straight to the studio without a spinner flashing first
const LOADING_DELAY = 0.15;

const DOCS_URL = `${LINKS.SOURCE}/blob/main/docs/index.md`;

/**
 * The server's version for the line under the card, from the public liveness
 * check (the status endpoint needs a session). Until it answers, or if it
 * cannot, the line names the product without a number.
 */
function useServerVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const ask = new AbortController();
    fetch('/health', { signal: ask.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ version?: unknown }>) : null))
      .then((body) => {
        if (typeof body?.version === 'string') setVersion(body.version);
      })
      .catch((err: unknown) => {
        // an abort is this screen going away, not a failure
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.warn('could not read the server version from /health', err);
        }
      });
    return () => ask.abort();
  }, []);
  return version;
}

/**
 * The screen every signed-out view shares: the mark, a title and one line,
 * and a raised card for what changes. `contentKey` "loading" shows the
 * children bare, without the card.
 */
export function AuthScreen({
  children,
  contentKey,
  title = 'Sluby Studio',
  footer,
}: {
  children: ReactNode;
  contentKey: string;
  title?: string;
  /** under the card, such as the version and docs line */
  footer?: ReactNode;
}) {
  return (
    // the design's sign-in: the mark, the title and one line, a raised card
    // that rises in, and the version and docs under it, centred on the ground
    <m.div
      className="fixed inset-0 grid place-items-center overflow-y-auto bg-background px-5 py-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...transition.base, delay: contentKey === 'loading' ? LOADING_DELAY : 0 }}
    >
      <main className="flex w-full max-w-100 flex-col items-center gap-6 text-center">
        <Logo className="size-12" />
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="font-heading text-title">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Video hosting on your own server, stored on Sia.
          </p>
        </div>
        {/* the brand stays put while what is below it changes. the old and new
            content share one grid cell instead of waiting for each other:
            with mode="wait" the next screen mounted only after the previous
            one's exit finished, and when /auth/me answered before motion's
            features had loaded, that exit never finished and the sign-in
            button never appeared (FLW-01). the spinner has no exit at all. */}
        <div className="grid w-full *:col-start-1 *:row-start-1">
          <AnimatePresence initial={false}>
            {contentKey === 'loading' ? (
              <div key="loading" className="flex min-h-24 w-full flex-col items-center gap-8">
                {children}
              </div>
            ) : (
              <m.div
                key={contentKey}
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="flex w-full flex-col gap-3.5 rounded-3xl border bg-card p-6 text-left shadow-toast"
              >
                {children}
              </m.div>
            )}
          </AnimatePresence>
        </div>
        {footer}
      </main>
    </m.div>
  );
}

/** "Sluby 0.2.0 · Docs" under the card. */
export function ProductLine() {
  const version = useServerVersion();
  return (
    <p className="text-[13px] text-subtle-foreground">
      {version ? `Sluby ${version}` : 'Sluby'} ·{' '}
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary-hover"
      >
        Docs<span className="sr-only">, opens in a new tab</span>
      </a>
    </p>
  );
}

/**
 * A warning in the card, such as why the session ended. `alert` announces
 * it; a notice that is simply part of the screen passes false.
 */
export function AuthNotice({
  children,
  alert = true,
  className,
}: {
  children: ReactNode;
  alert?: boolean;
  className?: string;
}) {
  return (
    <div
      role={alert ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-warning-line px-3.5 py-3 text-sm',
        className,
      )}
    >
      <CircleAlert aria-hidden="true" className="mt-px size-4.5 shrink-0 text-warning-icon" />
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

/** "or" between the password form and the GitHub button. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      or
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
