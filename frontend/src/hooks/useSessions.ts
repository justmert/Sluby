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

type SessionList = { data: StudioSession[] };

const KEYS = ['studio-sessions'];

export function useSessions(enabled: boolean) {
  return useQuery({
    queryKey: KEYS,
    queryFn: () => apiClient.get<SessionList>('/auth/sessions'),
    enabled,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/auth/sessions/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEYS });
      const previous = qc.getQueryData<SessionList>(KEYS);
      qc.setQueryData<SessionList>(KEYS, (old) =>
        old ? { ...old, data: old.data.filter((s) => s.id !== id) } : old,
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEYS, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRevokeAllSessions() {
  return useMutation({
    mutationFn: () => apiClient.delete<{ success: boolean; revoked: number }>('/auth/sessions'),
  });
}
