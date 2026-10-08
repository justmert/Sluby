import { useState } from 'react';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { apiClient } from '@/lib/api-client';
import { loadPage } from '@/lib/navigation';
import { useSession } from '@/lib/session';

export function UserMenu() {
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await apiClient.post('/auth/logout');
    } catch (err) {
      // the session is still live, so reloading would sign straight back in
      setSigningOut(false);
      toast.error(`Could not sign out: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    loadPage('/studio');
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
            ? 'Sign-in is off (local dev account)'
            : `Signed in with ${session.providerLabel ?? 'an unknown provider'}`}
        </DropdownMenuLabel>
        <DropdownMenuLabel className="font-mono text-xs">{session.username}</DropdownMenuLabel>
        {session.operator && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Operator: sees deployment status and metrics
          </DropdownMenuLabel>
        )}
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
