import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/formatters';
import { OrDivider } from './AuthScreen';
import { AuthField, FormError, PasswordInput } from './fields';
import { EMAIL_MAX, emailProblem, NAME_MAX, nameProblem, newPasswordProblem } from './validation';
import { GitHubButton } from './GitHubButton';
import { SessionNotKeptError } from './sign-in-copy';
import { useAuthForm } from './use-auth-form';

type Field = 'name' | 'email' | 'password';

/** An invite link: make an account with an email and password, or with GitHub. */
export function JoinScreen({
  token,
  role,
  expiresAt,
  github,
  onSignedIn,
}: {
  token: string;
  role: 'admin' | 'member';
  expiresAt: string;
  github: boolean;
  onSignedIn: () => Promise<boolean>;
}) {
  const form = useAuthForm<Field>({
    initial: { name: '', email: '', password: '' },
    validate: (v) => ({
      name: nameProblem(v.name),
      email: emailProblem(v.email),
      password: newPasswordProblem(v.password),
    }),
    idOf: (f) => `join-${f}`,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sent = await form.submit((v) =>
      apiClient.post(`/auth/invites/${encodeURIComponent(token)}/accept`, {
        name: v.name.trim(),
        email: v.email.trim(),
        password: v.password,
      }),
    );
    if (sent && !(await onSignedIn())) form.fail(new SessionNotKeptError());
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">
          You are invited to join as {role === 'admin' ? 'an admin' : 'a member'}.
        </p>
        <p className="text-sm text-muted-foreground">
          This invite works until {formatDate(expiresAt)}.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <AuthField
          id="join-name"
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
          id="join-email"
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
          id="join-password"
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
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={form.pending}
          aria-busy={form.pending || undefined}
        >
          {form.pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {form.pending ? 'Joining…' : 'Join'}
        </Button>
      </form>
      {github && (
        <>
          <OrDivider />
          <GitHubButton
            href={() =>
              `/api/v1/auth/github/login?${new URLSearchParams({ invite: token, next: '/studio' })}`
            }
          />
        </>
      )}
    </>
  );
}
