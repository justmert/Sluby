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

/** A key as the server returns it right after creation or rotation: the listing plus its secret. */
export interface IssuedKey extends ApiKeyRecord {
  key: string;
  rotated_from?: string;
  previous_key_expires_at?: string;
}

interface KeyPage {
  data: ApiKeyRecord[];
  has_more: boolean;
  next_cursor: string | null;
}

const KEYS = ['api-keys'];

/** Every key of the account, following the cursor until the last page. */
async function listAllKeys(): Promise<{ data: ApiKeyRecord[] }> {
  const data: ApiKeyRecord[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?${new URLSearchParams({ cursor })}` : '';
    const page: KeyPage = await apiClient.get<KeyPage>(`/keys${query}`);
    data.push(...page.data);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return { data };
}

export function useApiKeys() {
  return useQuery({
    queryKey: KEYS,
    queryFn: listAllKeys,
    // a rotated key drops off the list when its grace period ends
    refetchInterval: 60_000,
  });
}

// the issued secret is handed to the dialog once; the mutation must not keep it
const secretMutation = { gcTime: 0 } as const;

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    ...secretMutation,
    mutationFn: (body: { name: string; scopes: KeyScope[]; rate_limit: number }) =>
      apiClient.post<IssuedKey>('/keys', body),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRotateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    ...secretMutation,
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
