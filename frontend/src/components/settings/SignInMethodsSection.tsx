import { useEffect, useState } from 'react';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { InlineError } from '@/components/shared/InlineError';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useUnlinkProvider } from '@/hooks/useAccount';
import { useAuthConfig } from '@/hooks/useAuthConfig';
import { loadPage } from '@/lib/navigation';
import { useRefreshSession, useSession } from '@/lib/session';
import { toastSuccess } from '@/lib/toast';
import { ChangeEmailDialog } from './ChangeEmailDialog';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { SETTINGS_SECTION } from './section';
import { METHODS_LIST, MethodRow, PasswordRow, SignInMethodsHeader } from './SignInMethodsHeader';

const LINK_GITHUB_URL = `/api/v1/auth/github/login?${new URLSearchParams({
  link: '1',
  next: '/studio/settings',
})}`;

/** Link GitHub: leaves for GitHub, so it stays pending while the browser goes. */
function LinkGitHubButton() {
  const [redirecting, setRedirecting] = useState(false);
  // back from github restores this page from the cache with the button pending
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  return (
    <Button
      variant="outline"
      className="h-8 pointer-coarse:h-10"
      disabled={redirecting}
      onClick={() => {
        setRedirecting(true);
        loadPage(LINK_GITHUB_URL);
      }}
    >
      {redirecting && <Spinner aria-hidden="true" />}
      {redirecting ? 'Redirecting to GitHub…' : 'Link GitHub'}
    </Button>
  );
}

/** The ways this account signs in: its password, and GitHub when the server has it. */
export function SignInMethodsSection() {
  const session = useSession();
  const config = useAuthConfig();
  const refresh = useRefreshSession();
  const unlink = useUnlinkProvider();
  const [changing, setChanging] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [removing, setRemoving] = useState(false);
  const password = session.signIn.find((m) => m.provider === 'password');
  const github = session.signIn.find((m) => m.provider === 'github');
  // the server keeps the way this browser signed in, and the only way in
  const githubRemovable = Boolean(github && password && session.provider !== 'github');
  const githubKept = !github
    ? null
    : !password
      ? 'Your only way to sign in, so it stays.'
      : session.provider === 'github'
        ? 'You signed in with it in this browser. Sign in with your password to remove it.'
        : null;

  return (
    <section aria-labelledby="settings-sign-in" className={SETTINGS_SECTION}>
      <SignInMethodsHeader />
      <div className="flex flex-col gap-3">
        <ul className={METHODS_LIST}>
          <PasswordRow
            onChange={() => setChanging(true)}
            onChangeEmail={() => setChangingEmail(true)}
          />
          {config.data?.methods.github && (
            <MethodRow
              icon={<GitHubMark className="size-4.5" />}
              title="GitHub"
              detail={
                github ? (
                  <>
                    <span dir="auto">@{github.username}</span>
                    {githubKept && <span className="block">{githubKept}</span>}
                  </>
                ) : (
                  'Not linked to this account.'
                )
              }
              action={
                !github ? (
                  <LinkGitHubButton />
                ) : (
                  githubRemovable && (
                    <Button
                      variant="outline"
                      className="h-8 pointer-coarse:h-10"
                      onClick={() => setRemoving(true)}
                    >
                      Remove
                    </Button>
                  )
                )
              }
            />
          )}
        </ul>
        {/* without the config the GitHub row cannot be drawn; say so rather than leave it out quietly */}
        <InlineError
          error={config.isError ? config.error : null}
          title="Could not check the ways to sign in"
          onRetry={() => config.refetch()}
          retrying={config.isFetching}
        />
      </div>
      {password && (
        <>
          <ChangePasswordDialog
            open={changing}
            onOpenChange={setChanging}
            email={password.username}
          />
          <ChangeEmailDialog
            open={changingEmail}
            onOpenChange={setChangingEmail}
            email={password.username}
          />
        </>
      )}
      <ConfirmDialog
        item={removing ? true : null}
        onClose={() => setRemoving(false)}
        title="Remove GitHub?"
        description="You will sign in with your email and password only. Browsers that signed in with GitHub are signed out. You can link GitHub again later."
        confirmLabel="Remove"
        pendingLabel="Removing…"
        errorTitle="Could not remove GitHub"
        onConfirm={async () => {
          await unlink.mutateAsync('github');
          await refresh();
          toastSuccess('GitHub removed.');
        }}
      />
    </section>
  );
}
