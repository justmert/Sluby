import { useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
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
import { useSession } from '@/components/AuthGate';
import { apiClient } from '@/lib/api-client';

export function UserMenu() {
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await apiClient.post('/auth/logout');
    } finally {
      // full reload so the auth gate re-checks the (now cleared) session
      window.location.href = '/';
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <GitHubMark className="size-3.5" />
          <span className="max-w-[140px] truncate font-mono text-xs">{session.login}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {session.authDisabled ? 'Auth disabled (dev identity)' : 'Signed in with GitHub'}
        </DropdownMenuLabel>
        <DropdownMenuLabel className="font-mono text-xs">{session.login}</DropdownMenuLabel>
        {!session.authDisabled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signingOut} onSelect={signOut}>
              <LogOut />
              {signingOut ? 'Signing out...' : 'Sign out'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
