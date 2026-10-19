import { useRef, useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { PAGE_HEADS } from '@/components/layout/page-heads';
import { InviteButton } from '@/components/layout/page-actions';
import { InviteDialog } from '@/components/members/InviteDialog';
import { INVITES_TABLE, InvitesTable } from '@/components/members/InvitesTable';
import { MEMBERS_TABLE, MembersTable } from '@/components/members/MembersTable';
import { PENDING_INVITES_LEAD } from '@/components/members/link-copy';
import { ResetLinkDialog } from '@/components/members/ResetLinkDialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageHeader, SectionHeader } from '@/components/shared/PageHeader';
import { focusRowMenu } from '@/components/developers/row-focus';
import {
  useChangeRole,
  useInvites,
  useMembers,
  useRemoveMember,
  useRestoreMember,
  useRevokeInvite,
  type Member,
  type PendingInvite,
} from '@/hooks/useMembers';
import { withLead } from '@/lib/errors';
import { reloadPage } from '@/lib/navigation';
import { useSession, type Role } from '@/lib/session';
import { toastError, toastSuccess } from '@/lib/toast';

const INVITE_BUTTON_ID = 'invite-button';

const inviteButton = () => document.getElementById(INVITE_BUTTON_ID);

/** Members, their roles and pending invites, for admins (App.tsx wraps it in AdminOnly). */
export default function MembersPage() {
  const session = useSession();
  const members = useMembers();
  const invites = useInvites();
  const changeRole = useChangeRole();
  const remove = useRemoveMember();
  const restore = useRestoreMember();
  const revokeInvite = useRevokeInvite();

  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [resetFor, setResetFor] = useState<Member | null>(null);
  const [stepDown, setStepDown] = useState<Member | null>(null);
  const [revoking, setRevoking] = useState<PendingInvite | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // the row a dialog was opened from, where focus goes back once it closes;
  // a ref, since the dialog state is already cleared by then
  const openedFrom = useRef<string | null>(null);

  const track = async (id: string, work: () => Promise<unknown>) => {
    setBusy((s) => new Set(s).add(id));
    try {
      await work();
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  const setRole = (m: Member, role: Role) =>
    track(m.id, async () => {
      try {
        await changeRole.mutateAsync({ id: m.id, role });
        toastSuccess(`${m.name} is now ${role === 'admin' ? 'an admin' : 'a member'}.`);
      } catch (err) {
        toastError(withLead(`Could not change the role of ${m.name}`, err));
      }
    });

  const onRole = (m: Member, role: Role) => {
    // stepping down takes this page away, so it asks first
    if (m.id === session.id && role === 'member') {
      openedFrom.current = m.id;
      setStepDown(m);
      return;
    }
    void setRole(m, role);
  };

  const onRestore = (m: Member) =>
    void track(m.id, async () => {
      try {
        await restore.mutateAsync(m.id);
        toastSuccess(`${m.name} can sign in again.`);
      } catch (err) {
        toastError(withLead(`Could not restore ${m.name}`, err));
      }
    });

  const backToRow = (e: Event) => {
    e.preventDefault();
    focusRowMenu(MEMBERS_TABLE, [openedFrom.current], inviteButton);
  };

  return (
    <PageContainer>
      <PageHeader
        {...PAGE_HEADS.members}
        primaryAction={<InviteButton id={INVITE_BUTTON_ID} onClick={() => setInviting(true)} />}
      />
      <MembersTable
        rows={members.data}
        error={members.error}
        onRetry={() => members.refetch()}
        retrying={members.isFetching}
        selfId={session.id}
        busyIds={busy}
        actions={{
          onRole,
          onRemove: (m) => {
            openedFrom.current = m.id;
            setRemoving(m);
          },
          onRestore,
          onResetLink: (m) => {
            openedFrom.current = m.id;
            setResetFor(m);
          },
        }}
      />
      <section aria-labelledby="pending-invites" className="mt-10">
        <SectionHeader
          id="pending-invites"
          title="Pending invites"
          description={PENDING_INVITES_LEAD}
        />
        <InvitesTable
          rows={invites.data}
          error={invites.error}
          onRetry={() => invites.refetch()}
          retrying={invites.isFetching}
          onRevoke={setRevoking}
        />
      </section>

      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <ResetLinkDialog
        member={resetFor}
        onClose={() => setResetFor(null)}
        onCloseAutoFocus={backToRow}
      />
      <ConfirmDialog
        item={removing}
        onClose={() => setRemoving(null)}
        title="Remove this member?"
        description={(m) => (
          <>
            <span dir="auto">{m.name}</span> can no longer sign in. Their sessions end and their API
            keys stop working. You can restore them later.
          </>
        )}
        confirmLabel="Remove"
        pendingLabel="Removing…"
        errorTitle="Could not remove the member"
        onConfirm={async (m) => {
          await remove.mutateAsync(m.id);
          toastSuccess(`${m.name} was removed.`);
        }}
        onCloseAutoFocus={backToRow}
      />
      <ConfirmDialog
        item={stepDown}
        onClose={() => setStepDown(null)}
        title="Stop being an admin?"
        description="You lose Members, Health and Metrics. Another admin can make you an admin again."
        confirmLabel="Make me a member"
        pendingLabel="Changing…"
        errorTitle="Could not change your role"
        onConfirm={async (m) => {
          await changeRole.mutateAsync({ id: m.id, role: 'member' });
          // the session still says admin; load it again as a member
          reloadPage();
        }}
        onCloseAutoFocus={backToRow}
      />
      <ConfirmDialog
        item={revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this invite?"
        description="Its link stops working. This cannot be undone."
        confirmLabel="Revoke"
        pendingLabel="Revoking…"
        errorTitle="Could not revoke the invite"
        onConfirm={async (i) => {
          await revokeInvite.mutateAsync(i.id);
          toastSuccess('Invite revoked.');
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          // the revoked row is gone; the next one or the invite button takes focus
          const rows = invites.data ?? [];
          focusRowMenu(INVITES_TABLE, [rows[0]?.id], inviteButton);
        }}
      />
    </PageContainer>
  );
}
