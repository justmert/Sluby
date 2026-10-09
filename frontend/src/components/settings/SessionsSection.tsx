import { useRef, useState } from 'react';
import { LogOut, Monitor, Smartphone } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { SectionHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
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
import { formatDate, formatRelativeTime, NO_VALUE } from '@/lib/formatters';
import { useSession } from '@/lib/session';
import { toastError, toastSuccess } from '@/lib/toast';
import { browserLabel } from '@/lib/user-agent';

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** When a browser was last used; this one is in use right now. */
function lastActive(s: StudioSession): string {
  if (s.current) return 'Just now';
  return s.lastSeenAt ? sentence(formatRelativeTime(s.lastSeenAt)) : NO_VALUE;
}

function BrowserCell({ session }: { session: StudioSession }) {
  const { label, mobile } = browserLabel(session.userAgent);
  const Icon = mobile ? Smartphone : Monitor;
  return (
    // nowrap: the icon never sits alone on a line above a long name
    <span className="flex min-w-0 flex-nowrap items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate" title={session.userAgent ?? undefined}>
        {label}
      </span>
      {session.current && <StatusBadge kind="session" status="current" className="shrink-0" />}
    </span>
  );
}

/** The browsers signed in as this account, each with Sign out, and Sign out everywhere. */
export function SessionsSection() {
  const session = useSession();
  const sessions = useSessions(true);
  const revoke = useRevokeSession();
  const signOutEverywhere = useSignOutEverywhere();
  const [confirmAll, setConfirmAll] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const rows = sessions.data;

  // the row leaves at once, and its button with it; keep focus in the list
  // (the next browser's Sign out), or on Sign out everywhere when none are left
  const keepFocus = (failedId?: string) =>
    requestAnimationFrame(() => {
      const section = sectionRef.current;
      if (!section) return;
      const again = failedId && section.querySelector<HTMLElement>(`[data-sign-out="${failedId}"]`);
      const next = section.querySelector<HTMLElement>('[data-sign-out]');
      (again || next || section.querySelector<HTMLElement>('[data-sign-out-all]'))?.focus();
    });

  const signOutOther = async (s: StudioSession) => {
    const hadFocus = document.activeElement?.getAttribute('data-sign-out') === s.id;
    if (hadFocus) keepFocus();
    try {
      await revoke.mutateAsync(s.id);
      toastSuccess('Signed out that browser');
    } catch (err) {
      // gone already is what was asked for; the list refetches either way
      if (statusOf(err) === 404) toastSuccess('That browser was already signed out.');
      else {
        toastError(withLead('Could not sign out that browser', err));
        if (hadFocus) keepFocus(s.id);
      }
    }
  };

  const columns: DataTableColumn<StudioSession>[] = [
    {
      id: 'browser',
      header: 'Browser',
      primary: true,
      cell: (s) => <BrowserCell session={s} />,
    },
    {
      id: 'created',
      header: 'Signed in',
      cell: (s) => <span title={formatRelativeTime(s.createdAt)}>{formatDate(s.createdAt)}</span>,
    },
    {
      id: 'seen',
      header: 'Last active',
      cell: (s) => (
        <span title={s.lastSeenAt ? formatDate(s.lastSeenAt) : undefined}>{lastActive(s)}</span>
      ),
    },
    {
      id: 'expires',
      header: 'Expires',
      // "in 6 days" rather than "in 5 days 23 hours": the exact time is in the
      // tooltip, and the long form pushed Sign out out of the card at 768
      cell: (s) => <span title={formatDate(s.expiresAt)}>{formatRelativeTime(s.expiresAt)}</span>,
    },
    {
      id: 'action',
      header: <span className="sr-only">Actions</span>,
      label: '',
      align: 'right',
      cell: (s) => {
        // this browser signs out from Account above, which also leaves the page
        if (s.current) return null;
        const pending = revoke.isPending && revoke.variables === s.id;
        const { label } = browserLabel(s.userAgent);
        return (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            aria-label={`Sign out ${label}`}
            data-sign-out={s.id}
            onClick={() => void signOutOther(s)}
          >
            {pending ? <Spinner aria-hidden="true" /> : <LogOut aria-hidden="true" />}
            Sign out
          </Button>
        );
      },
    },
  ];

  const others = rows?.filter((s) => !s.current).length ?? 0;

  return (
    <section ref={sectionRef} aria-labelledby="settings-browsers">
      <SectionHeader
        id="settings-browsers"
        title="Signed-in browsers"
        description={
          <>
            Where you are signed in as <span dir="auto">{session.username}</span>.
          </>
        }
        // always there, so the header does not grow when the list lands;
        // it signs this browser out too, so it works with no others listed
        action={
          <Button variant="outline" size="sm" data-sign-out-all onClick={() => setConfirmAll(true)}>
            <LogOut aria-hidden="true" />
            Sign out everywhere
          </Button>
        }
      />
      <DataTable
        caption="Signed-in browsers"
        columns={columns}
        rows={rows}
        getRowId={(s) => s.id}
        getRowLabel={(s) => browserLabel(s.userAgent).label}
        loadingRows={2}
        error={sessions.error}
        onRetry={() => sessions.refetch()}
        retrying={sessions.isFetching}
        what="your signed-in browsers"
      />
      {rows && others === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">No other browsers are signed in.</p>
      )}
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
