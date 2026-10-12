import { LogOut } from 'lucide-react';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { DescriptionItem, DescriptionList } from '@/components/shared/DescriptionList';
import { SectionHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useSignOut } from '@/hooks/useSessions';
import { withLead } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { toastError } from '@/lib/toast';
import { SETTINGS_HEAD, SETTINGS_SECTION } from './section';

export const AUTH_OFF_SENTENCE = 'Anyone who can open this address has operator access.';

/** Who is signed in, how, and with what role; Sign out for this browser. */
export function AccountSection() {
  const session = useSession();
  const { signOut, signingOut } = useSignOut();

  return (
    <section aria-labelledby="settings-account" className={SETTINGS_SECTION}>
      <SectionHeader id="settings-account" title="Account" className={SETTINGS_HEAD} />
      <Card>
        <CardContent>
          <DescriptionList>
            <DescriptionItem label="Username">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {session.provider === 'github' && (
                  <GitHubMark className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span dir="auto" className="font-mono text-xs wrap-anywhere">
                  {session.username}
                </span>
              </span>
            </DescriptionItem>
            {session.authDisabled ? (
              <DescriptionItem label="Sign-in">
                <span className="flex flex-col gap-0.5">
                  <span>Sign-in is off on this server</span>
                  <span className="text-xs text-muted-foreground">{AUTH_OFF_SENTENCE}</span>
                </span>
              </DescriptionItem>
            ) : (
              <DescriptionItem label="Signed in with">{session.providerLabel}</DescriptionItem>
            )}
            <DescriptionItem label="Role">
              {session.operator ? (
                <span className="flex flex-col gap-0.5">
                  <span>Operator</span>
                  <span className="text-xs text-muted-foreground">
                    Can see server status, storage and metrics
                  </span>
                </span>
              ) : (
                'Member'
              )}
            </DescriptionItem>
          </DescriptionList>
        </CardContent>
        {!session.authDisabled && (
          <CardFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={signingOut}
              onClick={() =>
                void signOut().catch((err: unknown) =>
                  toastError(withLead('Could not sign out', err)),
                )
              }
            >
              {signingOut ? <Spinner aria-hidden="true" /> : <LogOut />}
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </CardFooter>
        )}
      </Card>
    </section>
  );
}
