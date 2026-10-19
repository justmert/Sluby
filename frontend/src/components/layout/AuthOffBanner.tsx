import { useState } from 'react';
import { ExternalLink, TriangleAlert, X } from 'lucide-react';
import { Collapse } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { LINKS } from '@/lib/constants';
import { useSession } from '@/lib/session';

export const AUTH_OFF_DISMISSED_KEY = 'sluby:auth-off-banner-dismissed';

// per tab session: a security warning should come back on the next visit,
// but local development must not be nagged on every page
function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(AUTH_OFF_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    sessionStorage.setItem(AUTH_OFF_DISMISSED_KEY, '1');
  } catch {
    // storage is off; the banner stays hidden for this page's life only
  }
}

/** With AUTH_DISABLED, a warning over every page that anyone who can reach it is an admin (D-15). */
export function AuthOffBanner() {
  const { authDisabled } = useSession();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!authDisabled) return null;

  return (
    <Collapse open={!dismissed}>
      {/* in the page column, as a card like the rest of the page: a full-width
        bar under the top bar read as broken chrome. neutral fill, the amber
        only on the icon tile, as the status chips do */}
      <div className="mx-auto w-full max-w-400 px-8 pt-6 max-[899px]:px-4 max-[899px]:pt-4">
        <div
          role="region"
          aria-label="Sign-in is off"
          className="flex items-start gap-3 rounded-xl border bg-card py-3 pr-3 pl-3.5 text-sm sm:items-center"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-warning-line text-warning-icon">
            <TriangleAlert className="size-4" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
            <p className="min-w-0 flex-1 text-muted-foreground">
              <span className="font-semibold text-foreground">Sign-in is off.</span> Anyone who can
              open this address has admin access.
            </p>
            <Button variant="outline" size="sm" className="self-start sm:self-auto" asChild>
              <a href={LINKS.SIGN_IN_SETUP} target="_blank" rel="noopener noreferrer">
                Turn on sign-in
                <ExternalLink data-icon="inline-end" className="size-3.5" aria-hidden="true" />
                <span className="sr-only">, opens in a new tab</span>
              </a>
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label="Hide this warning until the next visit"
            onClick={() => {
              writeDismissed();
              setDismissed(true);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
    </Collapse>
  );
}
