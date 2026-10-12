import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { InlineError } from '@/components/shared/InlineError';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  useRevokeSession,
  useSessions,
  useSignOutEverywhere,
  type StudioSession,
} from '@/hooks/useSessions';
import { statusOf } from '@/lib/api-client';
import { withLead } from '@/lib/errors';
import { formatDate, formatRelativeTime } from '@/lib/formatters';
import { useSession } from '@/lib/session';
import { toastError, toastSuccess } from '@/lib/toast';
import { browserLabel } from '@/lib/user-agent';
import { SESSION_ROW, SessionsHeader, SessionsLoading } from './SessionsHeader';
import { SETTINGS_SECTION } from './section';

/** "Oct 10" this year, "Oct 10, 2025" before it. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDate(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "Active now · signed in Oct 10" */
function activity(s: StudioSession): string {
  const active = s.current
    ? 'Active now'
    : s.lastSeenAt
      ? `Active ${formatRelativeTime(s.lastSeenAt)}`
      : 'Not seen since signing in';
  return `${active} · signed in ${shortDate(s.createdAt)}`;
}

function SessionRow({
  session: s,
  pending,
  onEnd,
}: {
  session: StudioSession;
  pending: boolean;
  onEnd: () => void;
}) {
  const { label } = browserLabel(s.userAgent);
  return (
    <li className={SESSION_ROW}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
          <span className="min-w-0 wrap-anywhere" title={s.userAgent ?? undefined}>
            {label}
          </span>
          {s.current && (
            <Badge variant="success" className="ml-1 h-5.5 font-semibold">
              This browser
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground" title={`Expires ${formatDate(s.expiresAt)}`}>
          {activity(s)}
        </div>
      </div>
      {/* this browser signs out from the account menu, which also leaves the page */}
      {!s.current && (
        <Button
          variant="outline"
          className="h-8 pointer-coarse:h-10"
          disabled={pending}
          aria-label={`End session on ${label}`}
          data-sign-out={s.id}
          onClick={onEnd}
        >
          {pending && <Spinner aria-hidden="true" />}
          End session
        </Button>
      )}
    </li>
  );
}

/** The browsers signed in as this account, each with End session, and Sign out everywhere. */
export function SessionsSection() {
  const session = useSession();
  const sessions = useSessions(true);
  const revoke = useRevokeSession();
  const signOutEverywhere = useSignOutEverywhere();
  const [confirmAll, setConfirmAll] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const rows = sessions.data;

  // the row leaves at once, and its button with it; keep focus in the list
  // (the next browser's End session), or on Sign out everywhere when none are left
  const keepFocus = (failedId?: string) =>
    requestAnimationFrame(() => {
      const section = sectionRef.current;
      if (!section) return;
      const again = failedId && section.querySelector<HTMLElement>(`[data-sign-out="${failedId}"]`);
      const next = section.querySelector<HTMLElement>('[data-sign-out]');
      (again || next || section.querySelector<HTMLElement>('[data-sign-out-all]'))?.focus();
    });

  const endSession = async (s: StudioSession) => {
    const hadFocus = document.activeElement?.getAttribute('data-sign-out') === s.id;
    if (hadFocus) keepFocus();
    try {
      await revoke.mutateAsync(s.id);
      toastSuccess('Signed out that browser');
    } catch (err) {
      // gone already is what was asked for; the list refetches either way
      if (statusOf(err) === 404) toastSuccess('That browser was already signed out');
      else {
        toastError(withLead('Could not sign out that browser', err));
        if (hadFocus) keepFocus(s.id);
      }
    }
  };

  const others = rows?.filter((s) => !s.current).length ?? 0;

  return (
    <section ref={sectionRef} aria-labelledby="settings-browsers" className={SETTINGS_SECTION}>
      <SessionsHeader />
      <div className="flex flex-col gap-3">
        {sessions.isPending ? (
          <SessionsLoading />
        ) : sessions.isError && !rows ? (
          <InlineError
            what="your signed-in browsers"
            error={sessions.error}
            onRetry={() => void sessions.refetch()}
            retrying={sessions.isFetching}
          />
        ) : (
          <>
            <ul
              aria-label="Signed-in browsers"
              className="overflow-hidden rounded-xl border bg-card text-sm"
            >
              {rows?.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  pending={revoke.isPending && revoke.variables === s.id}
                  onEnd={() => void endSession(s)}
                />
              ))}
            </ul>
            {others === 0 && (
              <p className="text-sm text-muted-foreground">No other browsers are signed in.</p>
            )}
          </>
        )}
        {/* always there, and it signs this browser out too, so it works with no others listed */}
        <Button
          variant="destructive-outline"
          className="self-start"
          data-sign-out-all
          onClick={() => setConfirmAll(true)}
        >
          Sign out everywhere
        </Button>
      </div>
      <ConfirmDialog
        item={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Sign out everywhere?"
        description={
          <>
            Every browser signed in as <span dir="auto">{session.username}</span> is signed out
            right away, this one included. API keys keep working.
          </>
        }
        confirmLabel="Sign out everywhere"
        pendingLabel="Signing out…"
        errorTitle="Could not sign out everywhere"
        onConfirm={signOutEverywhere}
      />
    </section>
  );
}
