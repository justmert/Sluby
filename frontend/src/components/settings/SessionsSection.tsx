import { useState } from 'react';
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
import { formatDate, formatRelativeTime, formatTimeLeft, NO_VALUE } from '@/lib/formatters';
import { useSession } from '@/lib/session';
import { toastError, toastSuccess } from '@/lib/toast';
import { browserLabel } from '@/lib/user-agent';

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** When a browser was last used; this one is in use right now. */
function lastActive(s: StudioSession): string {
  if (s.current) return 'Just now';
  return s.last_seen_at ? sentence(formatRelativeTime(s.last_seen_at)) : NO_VALUE;
}

function BrowserCell({ session }: { session: StudioSession }) {
  const { label, mobile } = browserLabel(session.user_agent);
  const Icon = mobile ? Smartphone : Monitor;
  return (
    // nowrap: the icon never sits alone on a line above a long name
    <span className="flex min-w-0 flex-nowrap items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate" title={session.user_agent ?? undefined}>
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
  const rows = sessions.data?.data;
  // B-10: servers before it send no last_seen_at at all; leave the column out there
  const knowsLastSeen = rows?.some((s) => s.last_seen_at !== undefined) ?? false;

  const signOutOther = async (s: StudioSession) => {
    try {
      await revoke.mutateAsync(s.id);
      toastSuccess('Signed out that browser');
    } catch (err) {
      // gone already is what was asked for; the list refetches either way
      if (statusOf(err) === 404) toastSuccess('That browser was already signed out.');
      else toastError(withLead('Could not sign out that browser', err));
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
      cell: (s) => <span title={formatRelativeTime(s.created_at)}>{formatDate(s.created_at)}</span>,
    },
    ...(knowsLastSeen
      ? [
          {
            id: 'seen',
            header: 'Last active',
            cell: (s: StudioSession) => (
              <span title={s.last_seen_at ? formatDate(s.last_seen_at) : undefined}>
                {lastActive(s)}
              </span>
            ),
          },
        ]
      : []),
    {
      id: 'expires',
      header: 'Expires',
      cell: (s) => <span title={formatDate(s.expires_at)}>{formatTimeLeft(s.expires_at)}</span>,
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
        const { label } = browserLabel(s.user_agent);
        return (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            aria-label={`Sign out ${label}`}
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
    <section aria-labelledby="settings-browsers">
      <SectionHeader
        id="settings-browsers"
        title="Signed-in browsers"
        description={
          <>
            Where you are signed in as <span dir="auto">{session.username}</span>.
          </>
        }
        action={
          rows && rows.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmAll(true)}>
              <LogOut aria-hidden="true" />
              Sign out everywhere
            </Button>
          ) : undefined
        }
      />
      <DataTable
        caption="Signed-in browsers"
        columns={columns}
        rows={rows}
        getRowId={(s) => s.id}
        getRowLabel={(s) => browserLabel(s.user_agent).label}
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
