import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/formatters';
import { AuthField, FormError, PasswordInput } from './fields';
import { confirmProblem, EMAIL_MAX, emailProblem, newPasswordProblem } from './validation';
import { SessionNotKeptError } from './sign-in-copy';
import { useAuthForm } from './use-auth-form';

type Field = 'email' | 'password' | 'confirm';

/**
 * A reset link: a new password, or the first one for a member who signed in
 * with GitHub only, who also picks the email they will sign in with.
 */
export function ResetScreen({
  token,
  email,
  expiresAt,
  onSignedIn,
}: {
  token: string;
  /** the account's sign-in email, or null when it has no password yet */
  email: string | null;
  expiresAt: string;
  onSignedIn: () => Promise<boolean>;
}) {
  const asksEmail = email === null;
  const form = useAuthForm<Field>({
    initial: { email: '', password: '', confirm: '' },
    validate: (v) => ({
      email: asksEmail ? emailProblem(v.email) : null,
      password: newPasswordProblem(v.password),
      confirm: confirmProblem(v.password, v.confirm),
    }),
    idOf: (f) => `reset-${f}`,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sent = await form.submit((v) =>
      apiClient.post(`/auth/invites/${encodeURIComponent(token)}/accept`, {
        password: v.password,
        ...(asksEmail ? { email: v.email.trim() } : {}),
      }),
    );
    if (sent && !(await onSignedIn())) form.fail(new SessionNotKeptError());
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="font-semibold wrap-anywhere">
          {asksEmail ? (
            'Choose the email and password you will sign in with.'
          ) : (
            <>
              Choose a new password for <span dir="auto">{email}</span>.
            </>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          This link works until {formatDate(expiresAt)}. Your other browsers are signed out.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {asksEmail ? (
          <AuthField
            id="reset-email"
            label="Email"
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
        ) : (
          // tells a password manager which account the new password is for
          <input type="email" autoComplete="username" value={email} readOnly hidden />
        )}
        <AuthField
          id="reset-password"
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
          id="reset-confirm"
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
        <FormError error={form.general} />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={form.pending}
          aria-busy={form.pending || undefined}
        >
          {form.pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {form.pending ? 'Saving…' : 'Set password'}
        </Button>
      </form>
    </>
  );
}
