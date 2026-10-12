import { Badge } from '@/components/ui/badge';
import { useSession } from '@/lib/session';
import { SETTINGS_SECTION, SectionLabel } from './section';

const AUTH_OFF_SENTENCE = 'Anyone who can open this address has operator access.';

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
  const name = session.name || session.username;

  return (
    <section aria-labelledby="settings-account" className={SETTINGS_SECTION}>
      <SectionLabel id="settings-account" title="Account">
        {session.authDisabled
          ? 'Sign-in is off on this server.'
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
            ) : (
              <>
                <span dir="auto">@{session.username}</span>
                {session.providerLabel && ` on ${session.providerLabel}`}
              </>
            )}
          </div>
        </div>
        {session.operator ? (
          <Badge
            variant="progress"
            className="h-5.5 font-semibold"
            title="Can see server status, storage and metrics"
          >
            Operator
          </Badge>
        ) : (
          <Badge className="h-5.5 font-semibold">Member</Badge>
        )}
      </div>
    </section>
  );
}
