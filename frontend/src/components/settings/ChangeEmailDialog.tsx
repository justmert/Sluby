import { AuthField, FormError, PasswordInput } from '@/components/auth/fields';
import { useAuthForm } from '@/components/auth/use-auth-form';
import { EMAIL_MAX, emailProblem } from '@/components/auth/validation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useChangeEmail } from '@/hooks/useAccount';
import { useRefreshSession } from '@/lib/session';
import { toastSuccess } from '@/lib/toast';

type Field = 'email' | 'current';

/** The form, mounted only while the dialog is open, so nothing typed outlives it. */
function ChangeEmailForm({
  email,
  onDone,
  onCancel,
}: {
  email: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const change = useChangeEmail();
  const refresh = useRefreshSession();
  const form = useAuthForm<Field>({
    initial: { email: '', current: '' },
    validate: (v) => ({
      email:
        emailProblem(v.email) ??
        (v.email.trim().toLowerCase() === email ? 'This is already your email.' : null),
      current: v.current === '' ? 'Enter your current password.' : null,
    }),
    idOf: (f) => `change-email-${f}`,
    serverField: { email: 'email', current_password: 'current' },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sent = await form.submit(async (v) => {
      await change.mutateAsync({ email: v.email.trim(), current_password: v.current });
      await refresh();
    });
    // the mutation keeps the password as its variable until reset
    change.reset();
    if (!sent) return;
    onDone();
    toastSuccess('Email changed. Sign in with the new one from now on.');
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Change email</DialogTitle>
        <DialogDescription>
          You sign in with <span dir="auto">{email}</span> now. Your password stays the same.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <AuthField
          id="change-email-email"
          label="New email"
          error={form.shown('email')}
          input={(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={EMAIL_MAX}
              value={form.values.email}
              onChange={(e) => form.set('email')(e.target.value)}
              onBlur={form.touch('email')}
            />
          )}
        />
        <AuthField
          id="change-email-current"
          label="Current password"
          error={form.shown('current')}
          input={(props) => (
            <PasswordInput
              {...props}
              autoComplete="current-password"
              value={form.values.current}
              onChange={(e) => form.set('current')(e.target.value)}
              onBlur={form.touch('current')}
            />
          )}
        />
      </FieldGroup>
      <FormError error={form.general} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={form.pending} aria-busy={form.pending || undefined}>
          {form.pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {form.pending ? 'Saving…' : 'Change email'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Change the email the signed-in member signs in with, given their password. */
export function ChangeEmailDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the account's sign-in email now */
  email: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ChangeEmailForm
          email={email}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
