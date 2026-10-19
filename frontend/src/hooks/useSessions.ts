import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { StudioSession } from '@sluby/sdk';
import { apiClient, statusOf } from '@/lib/api-client';
import { replacePage } from '@/lib/navigation';
import { sluby } from '@/lib/sluby';

export type { StudioSession };

const KEYS = ['studio-sessions'];

/** The browsers list's query key, for changes elsewhere that end sessions. */
export const SESSIONS_KEY = KEYS;

/** The browsers signed in as this account, newest first (sdk `sessions.list`). */
export function useSessions(enabled: boolean) {
  return useQuery({
    queryKey: KEYS,
    queryFn: ({ signal }) => sluby.sessions.list({ signal }),
    enabled,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sluby.sessions.revoke(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEYS });
      const previous = qc.getQueryData<StudioSession[]>(KEYS);
      qc.setQueryData<StudioSession[]>(KEYS, (old) => old?.filter((s) => s.id !== id));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEYS, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

/**
 * This browser is signed out: drop every cached answer now, so nothing
 * private survives in memory, and load /studio in place of this history
 * entry, so Back does not return to the signed-in page. The auth gate also
 * checks again if the back/forward cache restores the page anyway.
 */
export function leaveSignedIn(qc: QueryClient): void {
  qc.clear();
  replacePage('/studio');
}

/**
 * Sign out with `request` (this browser, or every browser) and leave. A 401
 * means the session is already gone, which is what was asked for; any other
 * failure is thrown and the session is still live, so the page stays.
 *
 * The calls go straight to the api rather than through a mutation: a 401
 * there would make the query client report the session ended, and the gate
 * would flash its "session ended" screen before the page reloads.
 */
async function signOutWith(qc: QueryClient, request: () => Promise<unknown>): Promise<void> {
  try {
    await request();
  } catch (err) {
    if (statusOf(err) !== 401) throw err;
  }
  leaveSignedIn(qc);
}

/** Sign this browser out: POST /auth/logout, then leave. */
export function useSignOut() {
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutWith(qc, () => apiClient.post('/auth/logout'));
    } catch (err) {
      setSigningOut(false);
      throw err;
    }
  };
  return { signOut, signingOut };
}

/** Sign out every browser of this account, this one included: DELETE /auth/sessions, then leave. */
export function useSignOutEverywhere() {
  const qc = useQueryClient();
  return () => signOutWith(qc, () => sluby.sessions.revokeAll());
}
