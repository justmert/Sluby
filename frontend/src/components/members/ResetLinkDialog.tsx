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
import { Spinner } from '@/components/ui/spinner';
import { useFrozen } from '@/hooks/useFrozen';
import { useCreateResetLink, type IssuedLink, type Member } from '@/hooks/useMembers';
import { LinkReveal } from './LinkReveal';
import { linkExpiry } from './link-copy';

const hasPassword = (m: Member) => m.sign_in.some((s) => s.provider === 'password');

/**
 * A link where a member sets a new password, or a first one when they sign
 * in with GitHub only. Made on request, then shown once.
 */
export function ResetLinkDialog({
  member,
  onClose,
  onCloseAutoFocus,
}: {
  /** open while set */
  member: Member | null;
  onClose: () => void;
  /** where focus goes once it closes: the menu item that opened it is gone */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const create = useCreateResetLink();
  const open = member !== null;
  // the page clears `member` on close; keep the text while the dialog fades
  const shown = useFrozen(member, open);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIssued(null);
  }

  const close = () => {
    create.reset();
    onClose();
  };

  const make = async () => {
    if (!shown || create.isPending) return;
    try {
      const made = await create.mutateAsync(shown.id);
      create.reset();
      setIssued(made);
    } catch {
      // shown in the dialog
    }
  };

  const name = shown?.name ?? '';
  const first = shown ? !hasPassword(shown) : false;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>Reset link created</DialogTitle>
              <DialogDescription>This link is shown only once.</DialogDescription>
            </DialogHeader>
            <LinkReveal url={issued.url} label="reset link">
              Anyone with this link can set the password for <span dir="auto">{name}</span> until{' '}
              {linkExpiry(issued.expires_at)}. Send it only to them.
            </LinkReveal>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create a reset link?</DialogTitle>
              <DialogDescription>
                {first ? (
                  <>
                    <span dir="auto">{name}</span> signs in without a password today. With the link
                    they choose an email and password to sign in with.
                  </>
                ) : (
                  <>
                    With the link <span dir="auto">{name}</span> sets a new password. Their other
                    browsers are signed out when they do.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <InlineError error={create.error} title="Could not create the link" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                onClick={() => void make()}
                disabled={create.isPending}
                aria-busy={create.isPending || undefined}
              >
                {create.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
                {create.isPending ? 'Creating…' : 'Create link'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
