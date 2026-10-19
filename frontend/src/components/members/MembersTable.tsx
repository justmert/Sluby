import { KeyRound, RotateCcw, ShieldCheck, ShieldMinus, UserMinus, Users } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { withCells } from '@/components/shared/column-frames';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RowAction } from '@/components/shared/DataTable';
import type { Member } from '@/hooks/useMembers';
import { NO_VALUE, formatDate, formatRelativeTime } from '@/lib/formatters';
import type { Role } from '@/lib/session';
import { MEMBER_COLUMNS } from './columns';
import { ROLE_LABEL } from './link-copy';

export const MEMBERS_TABLE = 'Members';

const PROVIDER_LABEL: Record<string, string> = {
  password: 'Password',
  github: 'GitHub',
  local: 'Local',
};

/** How the table names one way to sign in: the email, or the GitHub login with an @. */
function methodText(provider: string, username: string): string {
  return provider === 'github' ? `@${username}` : username;
}

export interface MemberActions {
  /** the role select or a menu item asked for this role */
  onRole: (member: Member, role: Role) => void;
  onRemove: (member: Member) => void;
  onRestore: (member: Member) => void;
  onResetLink: (member: Member) => void;
}

/** Everyone in the workspace, removed members included, with what an admin can change. */
export function MembersTable({
  rows,
  error,
  onRetry,
  retrying,
  selfId,
  busyIds,
  actions,
}: {
  rows: Member[] | undefined;
  error: unknown;
  onRetry: () => unknown;
  retrying: boolean;
  /** the signed-in account, which cannot remove itself */
  selfId: string;
  /** members with a change on its way, whose role select waits */
  busyIds: ReadonlySet<string>;
  actions: MemberActions;
}) {
  const columns = withCells<Member>(MEMBER_COLUMNS, {
    name: (m) => (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span dir="auto" className="font-semibold wrap-anywhere">
          {m.name}
        </span>
        {m.id === selfId && <Badge className="h-5 font-medium">You</Badge>}
      </span>
    ),
    'sign-in': (m) =>
      m.sign_in.length === 0 ? (
        <span className="text-muted-foreground">{NO_VALUE}</span>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {m.sign_in.map((s) => (
            <li key={`${s.provider}:${s.username}`} className="wrap-anywhere">
              <span className="text-muted-foreground">
                {PROVIDER_LABEL[s.provider] ?? s.provider}
              </span>{' '}
              <span dir="auto">{methodText(s.provider, s.username)}</span>
            </li>
          ))}
        </ul>
      ),
    role: (m) => (
      <Select
        value={m.role}
        onValueChange={(v) => v !== m.role && actions.onRole(m, v as Role)}
        // a removed member's role waits until they are back
        disabled={m.status === 'removed' || busyIds.has(m.id)}
      >
        <SelectTrigger size="sm" className="w-28" aria-label={`Role of ${m.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="member">{ROLE_LABEL.member}</SelectItem>
          <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
        </SelectContent>
      </Select>
    ),
    status: (m) => <StatusBadge kind="member" status={m.status} />,
    'last-sign-in': (m) =>
      m.last_sign_in_at === null ? (
        <span>Never</span>
      ) : (
        <time dateTime={m.last_sign_in_at} title={formatDate(m.last_sign_in_at)}>
          {formatRelativeTime(m.last_sign_in_at)}
        </time>
      ),
  });

  const rowActions = (m: Member): RowAction[] => {
    const list: RowAction[] = [];
    if (m.status === 'active') {
      list.push(
        m.role === 'admin'
          ? { label: 'Make member', icon: ShieldMinus, onSelect: () => actions.onRole(m, 'member') }
          : { label: 'Make admin', icon: ShieldCheck, onSelect: () => actions.onRole(m, 'admin') },
        { label: 'Create reset link', icon: KeyRound, onSelect: () => actions.onResetLink(m) },
      );
      if (m.id !== selfId) {
        list.push({
          label: 'Remove',
          icon: UserMinus,
          destructive: true,
          onSelect: () => actions.onRemove(m),
        });
      }
    } else {
      list.push({ label: 'Restore', icon: RotateCcw, onSelect: () => actions.onRestore(m) });
    }
    return list;
  };

  return (
    <DataTable
      caption={MEMBERS_TABLE}
      rows={rows}
      columns={columns}
      getRowId={(m) => m.id}
      getRowLabel={(m) => m.name}
      loadingRows={3}
      error={error}
      onRetry={onRetry}
      retrying={retrying}
      what="the members"
      // a removed member reads quieter: they cannot sign in
      rowClassName={(m) => (m.status === 'removed' ? 'text-muted-foreground' : undefined)}
      rowActions={rowActions}
      empty={
        <EmptyState icon={Users} title="No members yet" description="Invite people to join." />
      }
    />
  );
}
