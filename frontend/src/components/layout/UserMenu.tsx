import { ArrowUpRight, ChevronDown, FileText, LogOut, Palette, UserRound } from 'lucide-react';
import { toastError } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useSignOut } from '@/hooks/useSessions';
import { LINKS } from '@/lib/constants';
import { withLead } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { THEME_OPTIONS, useTheme, type Theme } from '@/lib/theme';

export function UserMenu() {
  const session = useSession();
  const { theme, setTheme } = useTheme();
  const { signOut, signingOut } = useSignOut();

  return (
    // not modal: a modal menu aria-hides the rest of the page around its
    // trigger, links and buttons included, which screen readers then see as
    // hidden but focusable. Escape and a click outside still close it. its
    // content stays in the top bar, inside the banner landmark
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* below 24rem (a phone, or a 32px default font) it drops its chevron
            and side padding so the top bar still fits (A11Y-46) */}
        <Button variant="outline" size="sm" className="gap-2 max-[24rem]:gap-1 max-[24rem]:px-1.5">
          {session.provider === 'github' ? (
            <GitHubMark className="size-3.5" />
          ) : (
            <UserRound className="size-3.5" />
          )}
          <span
            dir="auto"
            className="max-w-[140px] truncate font-mono text-xs max-sm:sr-only"
            title={session.username}
          >
            {session.username}
          </span>
          {session.operator && <span className="sr-only">, operator</span>}
          {session.authDisabled && (
            <>
              <Badge
                variant="warning"
                aria-hidden="true"
                className="h-4 px-1.5 text-kbd max-sm:hidden"
              >
                Sign-in off
              </Badge>
              <span className="sr-only">, sign-in off</span>
            </>
          )}
          <ChevronDown className="size-3 text-muted-foreground max-[24rem]:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" portal={false}>
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
        {/* the theme lives here, in settings and in the palette; not in the top bar */}
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
