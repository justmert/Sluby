import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SectionLabel } from './section';

/**
 * The signed-in browsers label column. Its own module so the settings route
 * skeleton draws the same lines. The route skeleton still passes the props
 * of the old header (the username and the sign out handler); they are
 * accepted and unused until it switches to SessionsLoading.
 */
export function SessionsHeader(_: { username?: string; onSignOutAll?: () => void }) {
  return (
    <SectionLabel id="settings-browsers" title="Signed-in browsers">
      End a session you do not recognise.
    </SectionLabel>
  );
}

export const SESSION_ROW = 'flex items-center gap-3 border-muted px-4.5 py-3.5 [&+&]:border-t';

/** The browsers list while it loads, at the height of two rows and the button under them. */
export function SessionsLoading({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border bg-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={SESSION_ROW}>
            <div className="flex flex-1 flex-col gap-2 py-0.5">
              <Skeleton className={cn('h-3.5 w-36', lateReveal)} />
              <Skeleton className={cn('h-3.5 w-52', lateReveal)} />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className={cn('h-9 w-40', lateReveal)} />
    </div>
  );
}
