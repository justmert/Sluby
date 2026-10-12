import { ArrowUpRight, FileText, LogOut, Palette } from 'lucide-react';
import { toastError } from '@/lib/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useSignOut } from '@/hooks/useSessions';
import { LINKS } from '@/lib/constants';
import { errorText, withLead } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { THEME_OPTIONS, useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Two letters for the avatar: the first of the first two words of the name, or of the username. */
export function initialsOf(name: string, username: string): string {
  const words = (name.trim() || username.trim()).split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters =
    words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...words[0]].slice(0, 2).join('');
  return letters.toLocaleUpperCase();
}

/**
 * "Sluby 0.2.0 · mainnet": which server this is and which Sia network it
 * stores on, at the foot of the account menu. When the status call fails it
 * says so, with the reason.
 */
function VersionLine() {
  const status = useSystemStatus({ poll: true });
  const line = 'text-xs font-normal text-muted-foreground tabular-nums';
  if (status.data) {
    return (
      <DropdownMenuLabel className={line}>
        Sluby {status.data.version} · {status.data.indexer.network}
      </DropdownMenuLabel>
    );
  }
  if (status.isError) {
    return (
      <DropdownMenuLabel className={cn(line, 'wrap-anywhere')}>
        Server version unavailable. {errorText(status.error)}
      </DropdownMenuLabel>
    );
  }
  // keeps the line's height while the first answer is on its way
  return (
    <DropdownMenuLabel className={line} aria-hidden="true">
      &nbsp;
    </DropdownMenuLabel>
  );
}

/**
 * The design's account button: a round 36px avatar with the initials. Its
 * name says what it is and whose it is; the menu holds the details.
 */
export function UserMenu({ className }: { className?: string }) {
  const session = useSession();
  const { theme, setTheme } = useTheme();
  const { signOut, signingOut } = useSignOut();
  const name = [
    `Account menu, ${session.username}`,
    session.operator && 'operator',
    session.authDisabled && 'sign-in off',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={name}
          title={session.username}
          className={cn(
            'grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-border text-[13px] font-semibold text-secondary-foreground hover:bg-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid pointer-coarse:size-11',
            className,
          )}
        >
          <span aria-hidden="true">{initialsOf(session.name, session.username)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {session.authDisabled
            ? 'Sign-in is off on this server'
            : `Signed in with ${session.providerLabel ?? 'an unknown provider'}`}
        </DropdownMenuLabel>
        <DropdownMenuLabel dir="auto" className="font-mono text-xs wrap-anywhere">
          {session.username}
        </DropdownMenuLabel>
        {session.operator && (
          <DropdownMenuLabel className="pt-0 text-xs font-normal text-muted-foreground">
            Operator
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        {/* all three themes live here, in settings and in the palette; the top
            bar toggle only flips between light and dark */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              {THEME_OPTIONS.map(({ value, label, icon: ItemIcon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <ItemIcon />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <a href={LINKS.API_REFERENCE} target="_blank" rel="noopener noreferrer">
            <FileText />
            API reference
            <ArrowUpRight className="ml-auto text-muted-foreground" aria-hidden="true" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={LINKS.SOURCE} target="_blank" rel="noopener noreferrer">
            <GitHubMark className="size-4" />
            Source on GitHub
            <ArrowUpRight className="ml-auto text-muted-foreground" aria-hidden="true" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <VersionLine />
        {!session.authDisabled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={signingOut}
              onSelect={() =>
                void signOut().catch((err: unknown) =>
                  toastError(withLead('Could not sign out', err)),
                )
              }
            >
              <LogOut />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
