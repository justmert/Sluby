import { useState } from 'react';
import { InlineError } from '@/components/shared/InlineError';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCreateInvite, type IssuedLink } from '@/hooks/useMembers';
import type { Role } from '@/lib/session';
import { LinkReveal } from './LinkReveal';
import { linkExpiry, ROLE_DETAIL, ROLE_LABEL } from './link-copy';

/**
 * Invite one person: pick their role, then copy the link, which is shown
 * only here. Each link lets one person join.
 */
export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateInvite();
  const [role, setRole] = useState<Role>('member');
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRole('member');
      setIssued(null);
    }
  }

  const close = (next: boolean) => {
    if (!next) create.reset();
    onOpenChange(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    try {
      const made = await create.mutateAsync(role);
      // the link lives only in this dialog from here on
      create.reset();
      setIssued({ url: made.url, expires_at: made.expires_at });
    } catch {
      // shown in the dialog
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite link created</DialogTitle>
              <DialogDescription>
                It joins as {role === 'admin' ? 'an admin' : 'a member'}. This link is shown only
                once.
              </DialogDescription>
            </DialogHeader>
            <LinkReveal url={issued.url} label="invite link">
              Anyone with this link can join until {linkExpiry(issued.expires_at)}. Send it to one
              person.
            </LinkReveal>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Invite people</DialogTitle>
              <DialogDescription>
                Make a link for one person. They choose their own email and password.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger
                  id="invite-role"
                  className="w-56 max-w-full"
                  aria-describedby="invite-role-help"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{ROLE_LABEL.member}</SelectItem>
                  <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription id="invite-role-help">{ROLE_DETAIL[role]}</FieldDescription>
            </Field>
            <InlineError error={create.error} title="Could not create the invite" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={create.isPending}
                aria-busy={create.isPending || undefined}
              >
                {create.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
                {create.isPending ? 'Creating…' : 'Create link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
