import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { RenameDialog } from './RenameDialog';
import { SETTINGS_SECTION, SectionLabel } from './section';

const AUTH_OFF_SENTENCE = 'Anyone who can open this address has admin access.';

/** "Mert Köklü" → "MK"; one word gives its first two letters. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters =
    words.length === 1
      ? [...words[0]].slice(0, 2)
      : [[...words[0]][0], [...words[words.length - 1]][0]];
  return letters.join('').toUpperCase();
}

/** Who is signed in, how, and with what role. */
export function AccountSection() {
  const session = useSession();
  const [renaming, setRenaming] = useState(false);
  const name = session.name || session.username;
  const byPassword = session.provider === 'password';

  return (
    <section aria-labelledby="settings-account" className={SETTINGS_SECTION}>
      <SectionLabel id="settings-account" title="Account">
        {session.authDisabled
          ? 'Sign-in is off on this server.'
          : byPassword
            ? 'Signed in with your password.'
            : `From your ${session.providerLabel ?? 'sign-in provider'} sign-in.`}
      </SectionLabel>
      <div className="flex items-center gap-3.5 rounded-xl border bg-card px-5 py-4.5 text-sm">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-border font-bold text-secondary-foreground"
        >
          {initialsOf(name)}
        </span>
        <div className="min-w-0 flex-1">
          <div dir="auto" className="font-semibold wrap-anywhere">
            {name}
          </div>
          <div className="text-muted-foreground wrap-anywhere">
            {session.authDisabled ? (
              AUTH_OFF_SENTENCE
            ) : byPassword ? (
              // a password account's handle is its email, which takes no @
              <span dir="auto">{session.username}</span>
            ) : (
              <>
                <span dir="auto">@{session.username}</span>
                {session.providerLabel && ` on ${session.providerLabel}`}
              </>
            )}
          </div>
        </div>
        {session.admin ? (
          <Badge
            variant="progress"
            className="h-5.5 font-semibold"
            title="Manages members and sees server status, storage and metrics"
          >
            Admin
          </Badge>
        ) : (
          <Badge className="h-5.5 font-semibold">Member</Badge>
        )}
        {!session.authDisabled && (
          <Button
            variant="outline"
            className="h-8 pointer-coarse:h-10"
            onClick={() => setRenaming(true)}
          >
            Edit name
          </Button>
        )}
      </div>
      <RenameDialog open={renaming} onOpenChange={setRenaming} name={session.name} />
    </section>
  );
}
