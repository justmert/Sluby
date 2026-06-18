import { useEffect, useRef, useState } from 'react';
import { Github, LogOut, ChevronDown } from 'lucide-react';
import { apiClient, ApiError } from '@/lib/api-client';

interface Session {
  login: string;
  authDisabled?: boolean;
}

export function UserMenu() {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiClient.get<Session>('/auth/me');
        if (!cancelled) setSession(me);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore — we'll force the UI back to sign-in regardless.
    }
    // Hard reload so the AuthGate re-evaluates the session.
    window.location.href = '/';
  };

  if (!session) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
        title={`Signed in as ${session.login}`}
      >
        <Github className="h-3.5 w-3.5 text-zinc-400" />
        <span className="font-mono max-w-[140px] truncate">{session.login}</span>
        <ChevronDown className="h-3 w-3 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-48 rounded-lg border border-white/[0.08] bg-[#0a0a0f] shadow-lg py-1 z-50">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/[0.06]">
            GitHub account
          </div>
          <div className="px-3 py-2 text-xs text-zinc-300 font-mono truncate">
            {session.login}
          </div>
          {session.authDisabled && (
            <div className="px-3 py-1.5 text-[10px] text-amber-400">
              Auth bypass (dev)
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] text-left border-t border-white/[0.06] disabled:opacity-60"
          >
            <LogOut className="h-3.5 w-3.5" />
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
