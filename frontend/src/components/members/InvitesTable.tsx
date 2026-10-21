import { Link2 } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { withCells } from '@/components/shared/column-frames';
import { EmptyState } from '@/components/shared/EmptyState';
import type { PendingInvite } from '@/hooks/useMembers';
import { NO_VALUE, formatDate, formatTimeLeft } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { INVITE_COLUMNS } from './columns';
import { ROLE_LABEL, inviteUses } from './link-copy';

export const INVITES_TABLE = 'Pending invites';

const inviteLabel = (i: PendingInvite) =>
  `${ROLE_LABEL[i.role]} invite from ${formatDate(i.created_at)}`;

/** Invites that still let someone join. Their links are not shown again. */
export function InvitesTable({
  rows,
  error,
  onRetry,
  retrying,
  onRevoke,
}: {
  rows: PendingInvite[] | undefined;
  error: unknown;
  onRetry: () => unknown;
  retrying: boolean;
  onRevoke: (invite: PendingInvite) => void;
}) {
  const columns = withCells<PendingInvite>(INVITE_COLUMNS, {
    role: (i) => <span className="font-semibold">{ROLE_LABEL[i.role]}</span>,
    joined: (i) => inviteUses(i.uses, i.max_uses),
    'created-by': (i) =>
      i.created_by ? (
        <span dir="auto" className="wrap-anywhere">
          {i.created_by.name}
        </span>
      ) : (
        // the admin who made it is no longer a member
        <span className="text-muted-foreground">{NO_VALUE}</span>
      ),
    created: (i) => <time dateTime={i.created_at}>{formatDate(i.created_at)}</time>,
    expires: (i) => (
      <time dateTime={i.expires_at} title={formatDate(i.expires_at)}>
        {formatTimeLeft(i.expires_at)}
      </time>
    ),
  });

  return (
    <DataTable
      caption={INVITES_TABLE}
      rows={rows}
      columns={columns}
      getRowId={(i) => i.id}
      getRowLabel={inviteLabel}
      animateRows
      loadingRows={1}
      error={error}
      onRetry={onRetry}
      retrying={retrying}
      what="the pending invites"
      rowActions={(i) => [
        { label: 'Revoke', icon: Icons.delete, destructive: true, onSelect: () => onRevoke(i) },
      ]}
      empty={
        <EmptyState
          variant="section"
          icon={Link2}
          title="No pending invites"
          description="Links you make show here until they are used up or expire."
        />
      }
    />
  );
}
