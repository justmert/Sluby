import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { SESSIONS_KEY } from './useSessions';

interface PasswordChange {
  current_password: string;
  new_password: string;
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
