import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api-client';
import { AuthNotice, OrDivider } from './AuthScreen';
import { AuthField, FormError, PasswordInput } from './fields';
import { GitHubButton } from './GitHubButton';
import { SessionNotKeptError } from './sign-in-copy';
import { useAuthForm } from './use-auth-form';

type Field = 'email' | 'password';

function githubLoginUrl() {
  const next = window.location.pathname + window.location.search + window.location.hash;
  return `/api/v1/auth/github/login?${new URLSearchParams({ next })}`;
}

/**
 * Email and password first, GitHub below when the server has it set up. While
 * no admin exists the screen points to the setup form, but members of an
 * upgraded install can still sign in here.
 */
export function SignInScreen({
  message,
  failure,
  github,
  setupRequired,
  onSetup,
  onSignedIn,
}: {
  /** why the session ended, when it did */
  message: string | null;
  /** why the last GitHub sign-in did not finish */
  failure: string | null;
  /** offer GitHub */
  github: boolean;
  setupRequired: boolean;
  onSetup: () => void;
  /** check the session again; false when the browser has none after all */
  onSignedIn: () => Promise<boolean>;
}) {
  const form = useAuthForm<Field>({
    initial: { email: '', password: '' },
    validate: (v) => ({
      email: v.email.trim() === '' ? 'Enter your email address.' : null,
      password: v.password === '' ? 'Enter your password.' : null,
    }),
    idOf: (f) => `signin-${f}`,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sent = await form.submit((v) =>
      apiClient.post('/auth/password', { email: v.email.trim(), password: v.password }),
    );
    if (sent && !(await onSignedIn())) form.fail(new SessionNotKeptError());
  };

  return (
    <>
      {(message || failure) && (
        <AuthNotice>
          {message && <p>{message}</p>}
          {failure && <p dir="auto">{failure}</p>}
        </AuthNotice>
      )}
      {setupRequired && (
        <AuthNotice alert={false}>
          <p>This server has no admin yet.</p>
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onSetup}>
            Set up the first admin
          </Button>
        </AuthNotice>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <AuthField
          id="signin-email"
          label="Email"
          error={form.shown('email')}
          input={(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={form.values.email}
              onChange={(e) => form.set('email')(e.target.value)}
              onBlur={form.touch('email')}
            />
          )}
        />
        <AuthField
          id="signin-password"
          label="Password"
          error={form.shown('password')}
          input={(props) => (
            <PasswordInput
              {...props}
              autoComplete="current-password"
              value={form.values.password}
              onChange={(e) => form.set('password')(e.target.value)}
              onBlur={form.touch('password')}
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
          {form.pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      {github && (
        <>
          <OrDivider />
          <GitHubButton href={githubLoginUrl} />
        </>
      )}
      <p className="text-center text-[13px] text-muted-foreground">
        New here? Ask an admin for an invite link.
      </p>
    </>
  );
}
