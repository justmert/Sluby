import { AuthField, FormError, PasswordInput } from '@/components/auth/fields';
import { useAuthForm } from '@/components/auth/use-auth-form';
import { confirmProblem, newPasswordProblem } from '@/components/auth/validation';
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
import { Spinner } from '@/components/ui/spinner';
import { useChangePassword } from '@/hooks/useAccount';
import { plural } from '@/lib/formatters';
import { toastSuccess } from '@/lib/toast';

type Field = 'current' | 'password' | 'confirm';

/** The form, mounted only while the dialog is open, so nothing typed outlives it. */
function ChangePasswordForm({
  email,
  onDone,
  onCancel,
}: {
  email: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const change = useChangePassword();
  const form = useAuthForm<Field>({
    initial: { current: '', password: '', confirm: '' },
    validate: (v) => ({
      current: v.current === '' ? 'Enter your current password.' : null,
      password: newPasswordProblem(v.password),
      confirm: confirmProblem(v.password, v.confirm),
    }),
    idOf: (f) => `change-password-${f}`,
    serverField: { current_password: 'current', new_password: 'password' },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let revoked = 0;
    const sent = await form.submit(async (v) => {
      const result = await change.mutateAsync({
        current_password: v.current,
        new_password: v.password,
      });
      revoked = result.revoked;
    });
    // the mutation keeps the passwords as its variables until reset
    change.reset();
    if (!sent) return;
    onDone();
    toastSuccess(
      revoked > 0
        ? `Password changed. Signed out ${plural(revoked, 'other browser')}.`
        : 'Password changed.',
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Change password</DialogTitle>
        <DialogDescription>Your other browsers are signed out.</DialogDescription>
      </DialogHeader>
      {/* tells a password manager which account the new password is for */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <FieldGroup>
        <AuthField
          id="change-password-current"
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
        <AuthField
          id="change-password-password"
          label="New password"
          error={form.shown('password')}
          hint="At least 10 characters."
          input={(props) => (
            <PasswordInput
              {...props}
              autoComplete="new-password"
              value={form.values.password}
              onChange={(e) => form.set('password')(e.target.value)}
              onBlur={form.touch('password')}
            />
          )}
        />
        <AuthField
          id="change-password-confirm"
          label="Confirm new password"
          error={form.shown('confirm')}
          input={(props) => (
            <PasswordInput
              {...props}
              autoComplete="new-password"
              value={form.values.confirm}
              onChange={(e) => form.set('confirm')(e.target.value)}
              onBlur={form.touch('confirm')}
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
          {form.pending ? 'Saving…' : 'Change password'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Change the signed-in account's password, given the current one. */
export function ChangePasswordDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the account's sign-in email */
  email: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ChangePasswordForm
          email={email}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
