import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { SESSIONS_KEY } from './useSessions';

interface PasswordChange {
  current_password: string;
  new_password: string;
}

/** PATCH /auth/me: the member's own name. */
export function useRename() {
  return useMutation({
    mutationFn: (name: string) => apiClient.patch<{ name: string }>('/auth/me', { name }),
  });
}

/** POST /auth/email/change: the email the member signs in with, given the password. */
export function useChangeEmail() {
  return useMutation({
    // the password is the mutation's variable; drop it as soon as it is done
    gcTime: 0,
    mutationFn: (body: { email: string; current_password: string }) =>
      apiClient.post<{ email: string }>('/auth/email/change', body),
  });
}

/** DELETE /auth/identities/:provider: stop signing in with GitHub. */
export function useUnlinkProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) =>
      apiClient.delete<{ success: boolean }>(`/auth/identities/${encodeURIComponent(provider)}`),
    // browsers that signed in with it were signed out
    onSuccess: () => qc.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}

/** POST /auth/password/change: `revoked` is how many other sessions ended. */
export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    // the passwords are the mutation's variables; drop them as soon as it is done
    gcTime: 0,
    mutationFn: (body: PasswordChange) =>
      apiClient.post<{ success: boolean; revoked: number }>('/auth/password/change', body),
    // the other browsers were signed out
    onSuccess: () => qc.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}
