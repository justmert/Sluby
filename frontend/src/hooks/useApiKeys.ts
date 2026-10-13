import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export type KeyScope = 'upload' | 'read' | 'manage';

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: KeyScope[];
  rate_limit: number;
  is_active: boolean;
  created_at: string;
  /** Set while a rotated-out key is in its grace period. */
  expires_at: string | null;
}

/** A key as the server returns it right after creation or rotation. */
export interface IssuedKey {
  id: string;
  key: string;
  name: string;
  scopes: KeyScope[];
  rate_limit: number;
  rotated_from?: string;
  previous_key_expires_at?: string;
}

const KEYS = ['api-keys'];

export function useApiKeys() {
  return useQuery({
    queryKey: KEYS,
    queryFn: () => apiClient.get<{ data: ApiKeyRecord[] }>('/keys'),
    // a rotated key drops off the list when its grace period ends
    refetchInterval: 60_000,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; scopes: KeyScope[]; rate_limit: number }) =>
      apiClient.post<IssuedKey>('/keys', body),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRotateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, graceSeconds }: { id: string; graceSeconds: number }) =>
      apiClient.post<IssuedKey>(`/keys/${id}/rotate`, { grace_period_seconds: graceSeconds }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/keys/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}
