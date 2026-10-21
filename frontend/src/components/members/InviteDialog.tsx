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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import {
  INVITE_DAYS,
  INVITE_DAYS_LABEL,
  MAX_INVITE_USES,
  linkExpiry,
  ROLE_DETAIL,
  ROLE_LABEL,
  type InviteDays,
} from './link-copy';

type Who = 'one' | 'some' | 'anyone';

const WHO_LABEL: Record<Who, string> = {
  one: 'One person',
  some: 'A number of people',
  anyone: 'Anyone with the link',
};

const DEFAULT_COUNT = '10';

/** Why a typed number of people is not one the server takes, or null. */
function countError(value: string): string | null {
  const n = Number(value);
  if (value.trim() === '' || !Number.isInteger(n) || n < 2 || n > MAX_INVITE_USES) {
    return `Enter a whole number from 2 to ${MAX_INVITE_USES}.`;
  }
  return null;
}

/** What the link allows, said under it once it is made. */
function issuedNote(who: Who, count: number, expiry: string): string {
  if (who === 'one')
    return `Anyone with this link can join until ${expiry}. Send it to one person.`;
  if (who === 'some') {
    return `Up to ${count} people can join as members with this link until ${expiry}.`;
  }
  return `Anyone with this link can join as a member until ${expiry}. Revoke it on this page to stop new people joining.`;
}

/**
 * Invite people: pick their role, how many may join with the link and for
 * how long, then copy the link, which is shown only here. A link for more
 * than one person always joins as a member, since it can be passed on.
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
  const [who, setWho] = useState<Who>('one');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [countTouched, setCountTouched] = useState(false);
  const [days, setDays] = useState<InviteDays>(7);
  const [issued, setIssued] = useState<(IssuedLink & { who: Who; count: number }) | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRole('member');
      setWho('one');
      setCount(DEFAULT_COUNT);
      setCountTouched(false);
      setDays(7);
      setIssued(null);
    }
  }

  const pickRole = (next: Role) => {
    setRole(next);
    // only a member link may be shared by several people
    if (next === 'admin') setWho('one');
  };

  const shownCountError = who === 'some' && countTouched ? countError(count) : null;

  const close = (next: boolean) => {
    if (!next) create.reset();
    onOpenChange(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    if (who === 'some' && countError(count)) {
      setCountTouched(true);
      return;
    }
    const maxUses = who === 'one' ? 1 : who === 'some' ? Number(count) : null;
    try {
      const made = await create.mutateAsync({ role, maxUses, expiresInDays: days });
      // the link lives only in this dialog from here on
      create.reset();
      setIssued({ url: made.url, expires_at: made.expires_at, who, count: maxUses ?? 0 });
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
              {issuedNote(issued.who, issued.count, linkExpiry(issued.expires_at))}
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
                Make a link for one person or for a group. They choose their own email and password.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                <Select value={role} onValueChange={(v) => pickRole(v as Role)}>
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
              <Field>
                <FieldLabel htmlFor="invite-who">Who can join</FieldLabel>
                <Select
                  value={who}
                  onValueChange={(v) => setWho(v as Who)}
                  disabled={role === 'admin'}
                >
                  <SelectTrigger
                    id="invite-who"
                    className="w-56 max-w-full"
                    aria-describedby="invite-who-help"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WHO_LABEL) as Who[]).map((w) => (
                      <SelectItem key={w} value={w}>
                        {WHO_LABEL[w]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription id="invite-who-help">
                  {role === 'admin'
                    ? 'An admin invite lets one person join.'
                    : 'A link for several people joins each of them as a member.'}
                </FieldDescription>
              </Field>
              {who === 'some' && (
                <Field data-invalid={!!shownCountError || undefined}>
                  <FieldLabel htmlFor="invite-count">Number of people</FieldLabel>
                  <Input
                    id="invite-count"
                    type="number"
                    inputMode="numeric"
                    min={2}
                    max={MAX_INVITE_USES}
                    step={1}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    onBlur={() => setCountTouched(true)}
                    className="w-32"
                    aria-invalid={shownCountError ? true : undefined}
                    aria-describedby={shownCountError ? 'invite-count-error' : undefined}
                  />
                  <FieldError id="invite-count-error">{shownCountError}</FieldError>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="invite-days">Link works for</FieldLabel>
                <Select
                  value={String(days)}
                  onValueChange={(v) => setDays(Number(v) as InviteDays)}
                >
                  <SelectTrigger id="invite-days" className="w-56 max-w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITE_DAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {INVITE_DAYS_LABEL[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
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
