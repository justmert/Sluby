import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTION, SectionLabel } from './section';

/**
 * The signed-in browsers label column. Its own module so the settings route
 * skeleton draws the same lines.
 */
export function SessionsHeader() {
  return (
    <SectionLabel id="settings-browsers" title="Signed-in browsers">
      End a session you do not recognise.
    </SectionLabel>
  );
}

export const SESSION_ROW = 'flex items-center gap-3 border-muted px-4.5 py-3.5 [&+&]:border-t';

/** The whole browsers section while the list loads, for the settings route skeleton. */
export function SessionsSectionLoading() {
  return (
    <section className={SETTINGS_SECTION}>
      <SessionsHeader />
      <div className="flex flex-col gap-3">
        <SessionsLoading />
        <SignOutEverywhereButton />
      </div>
    </section>
  );
}

/**
 * Sign out everywhere, an outlined red button that opens a confirm. It is
 * there while the list loads too, and it signs this browser out as well, so
 * it works with no others listed.
 */
export function SignOutEverywhereButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button
      variant="destructive-outline"
      className="self-start"
      data-sign-out-all
      onClick={onClick}
    >
      Sign out everywhere
    </Button>
  );
}

/** The browsers list while it loads, at the height of two rows. */
export function SessionsLoading({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl border bg-card">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={SESSION_ROW}>
          <div className="flex flex-1 flex-col gap-2 py-0.5">
            <Skeleton className={cn('h-3.5 w-36', lateReveal)} />
            <Skeleton className={cn('h-3.5 w-52', lateReveal)} />
          </div>
        </div>
      ))}
    </div>
  );
}
