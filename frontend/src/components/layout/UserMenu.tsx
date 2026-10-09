import { useState } from 'react';
import { ChevronDown, LogOut, Palette, UserRound } from 'lucide-react';
import { toastError } from '@/lib/toast';
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
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, statusOf } from '@/lib/api-client';
import { withLead } from '@/lib/errors';
import { replacePage } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { THEME_OPTIONS, useTheme, type Theme } from '@/lib/theme';

export function UserMenu() {
  const session = useSession();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await apiClient.post('/auth/logout');
    } catch (err) {
      // a 401 means the session is already gone, which is what was asked for
      if (statusOf(err) !== 401) {
        // the session is still live, so reloading would sign straight back in
        setSigningOut(false);
        toastError(withLead('Could not sign out', err));
        return;
      }
    }
    // drop every cached answer now, so nothing private survives in memory,
    // and replace this entry so Back does not return to the signed-in page
    queryClient.clear();
    replacePage('/studio');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {session.provider === 'github' ? (
            <GitHubMark className="size-3.5" />
          ) : (
            <UserRound className="size-3.5" />
          )}
          <span
            className="max-w-[140px] truncate font-mono text-xs max-sm:sr-only"
            title={session.username}
          >
            {session.username}
          </span>
          {session.operator && <span className="sr-only">, operator</span>}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {session.authDisabled
            ? 'Sign-in is off on this server'
            : `Signed in with ${session.providerLabel ?? 'an unknown provider'}`}
        </DropdownMenuLabel>
        <DropdownMenuLabel className="font-mono text-xs">{session.username}</DropdownMenuLabel>
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
        {!session.authDisabled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
              <LogOut />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
