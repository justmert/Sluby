import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api-client';
import { AuthField, FormError, PasswordInput } from './fields';
import { EMAIL_MAX, emailProblem, NAME_MAX, nameProblem, newPasswordProblem } from './validation';
import { reasonOf, SessionNotKeptError } from './sign-in-copy';
import { useAuthForm } from './use-auth-form';

type Field = 'code' | 'name' | 'email' | 'password';

/**
 * The first admin's account, guarded by the setup code the server prints in
 * its log while no admin can sign in.
 */
export function SetupScreen({
  onBack,
  onSignedIn,
}: {
  /** back to sign-in, checking the server again when `refresh` */
  onBack: (refresh: boolean) => void;
  onSignedIn: () => Promise<boolean>;
}) {
  const form = useAuthForm<Field>({
    initial: { code: '', name: '', email: '', password: '' },
    validate: (v) => ({
      code: v.code.trim() === '' ? 'Enter the setup code.' : null,
      name: nameProblem(v.name),
      email: emailProblem(v.email),
      password: newPasswordProblem(v.password),
    }),
    idOf: (f) => `setup-${f}`,
  });
  const alreadySetUp = reasonOf(form.error) === 'already_set_up';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sent = await form.submit((v) =>
      apiClient.post('/auth/setup', {
        code: v.code.trim(),
        name: v.name.trim(),
        email: v.email.trim(),
        password: v.password,
      }),
    );
    if (sent && !(await onSignedIn())) form.fail(new SessionNotKeptError());
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Create the first admin account. Admins invite everyone else.
      </p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <AuthField
          id="setup-code"
          label="Setup code"
          error={form.shown('code')}
          hint='The server prints it in its log, on the line that starts with "No admin can sign in yet".'
          input={(props) => (
            <Input
              {...props}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXXX-XXXXX"
              className="font-mono"
              value={form.values.code}
              onChange={(e) => form.set('code')(e.target.value)}
              onBlur={form.touch('code')}
            />
          )}
        />
        <AuthField
          id="setup-name"
          label="Your name"
          error={form.shown('name')}
          input={(props) => (
            <Input
              {...props}
              autoComplete="name"
              maxLength={NAME_MAX}
              dir="auto"
              value={form.values.name}
              onChange={(e) => form.set('name')(e.target.value)}
              onBlur={form.touch('name')}
            />
          )}
        />
        <AuthField
          id="setup-email"
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
        <AuthField
          id="setup-password"
          label="Password"
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
        <FormError error={form.general} />
        {alreadySetUp ? (
          <Button type="button" size="lg" className="w-full" onClick={() => onBack(true)}>
            Sign in instead
          </Button>
        ) : (
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={form.pending}
            aria-busy={form.pending || undefined}
          >
            {form.pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
            {form.pending ? 'Creating…' : 'Create admin account'}
          </Button>
        )}
      </form>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit self-center"
        onClick={() => onBack(false)}
      >
        <ArrowLeft aria-hidden="true" />
        Back to sign in
      </Button>
    </>
  );
}
