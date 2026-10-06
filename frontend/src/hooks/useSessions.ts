import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface StudioSession {
  id: string;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  /** The session this browser is using. */
  current: boolean;
}

const KEYS = ['studio-sessions'];

export function useSessions(enabled: boolean) {
  return useQuery({
    queryKey: KEYS,
    queryFn: () => apiClient.get<{ data: StudioSession[] }>('/auth/sessions'),
    enabled,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/auth/sessions/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRevokeAllSessions() {
  return useMutation({
    mutationFn: () => apiClient.delete<{ success: boolean; revoked: number }>('/auth/sessions'),
  });
}
