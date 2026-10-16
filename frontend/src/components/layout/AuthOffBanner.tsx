import { useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
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

/** With AUTH_DISABLED, a warning over every page that anyone who can reach it is an operator (D-15). */
export function AuthOffBanner() {
  const { authDisabled } = useSession();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!authDisabled) return null;

  return (
    <Collapse open={!dismissed}>
      <div
        role="region"
        aria-label="Sign-in is off"
        className="flex items-start gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm text-warning-foreground sm:items-center sm:px-8"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0 sm:mt-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          Sign-in is off. Anyone who can open this address has operator access.{' '}
          <a
            href={LINKS.SIGN_IN_SETUP}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium whitespace-nowrap underline underline-offset-2"
          >
            Turn on sign-in
            <span className="sr-only">, opens in a new tab</span>
          </a>
        </p>
        <Button
          variant="ghost"
          size="icon-xs"
          className="-my-1 shrink-0 text-warning-foreground hover:bg-warning/20 hover:text-warning-foreground"
          aria-label="Hide this warning until the next visit"
          onClick={() => {
            writeDismissed();
            setDismissed(true);
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </Collapse>
  );
}
