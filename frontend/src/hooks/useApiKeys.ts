import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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
  /**
   * The key's first 12 characters ("sluby_" and 6 more), null for keys made
   * before prefixes were stored. B-01: absent until the server has it.
   */
  prefix?: string | null;
  /** When a request last used the key, to the minute; null if never. B-01. */
  last_used_at?: string | null;
}

/** This server's limits on keys, to check a new key against. B-08. */
export interface KeyLimits {
  max_keys: number;
  max_rate_limit: number;
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
  /** B-08: absent until the server has it. */
  limits?: KeyLimits;
}

type KeyList = { data: ApiKeyRecord[]; limits?: KeyLimits };

const KEYS = ['api-keys'];

/** Every key of the account, following the cursor until the last page. */
async function listAllKeys(): Promise<KeyList> {
  const data: ApiKeyRecord[] = [];
  let limits: KeyLimits | undefined;
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?${new URLSearchParams({ cursor })}` : '';
    const page: KeyPage = await apiClient.get<KeyPage>(`/keys${query}`);
    data.push(...page.data);
    limits ??= page.limits;
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return limits ? { data, limits } : { data };
}

export function useApiKeys() {
  return useQuery({
    queryKey: KEYS,
    queryFn: listAllKeys,
    // a rotated key drops off the list when its grace period ends
    refetchInterval: 60_000,
  });
}

/** The listing part of an issued key: the secret must never reach the query cache. */
function listed(k: IssuedKey): ApiKeyRecord {
  const row: ApiKeyRecord = {
    id: k.id,
    name: k.name,
    scopes: k.scopes,
    rate_limit: k.rate_limit,
    is_active: k.is_active,
    created_at: k.created_at,
    expires_at: k.expires_at,
  };
  if (k.prefix !== undefined) row.prefix = k.prefix;
  if (k.last_used_at !== undefined) row.last_used_at = k.last_used_at;
  return row;
}

function editKeys(qc: QueryClient, edit: (rows: ApiKeyRecord[]) => ApiKeyRecord[]) {
  qc.setQueryData<KeyList>(KEYS, (old) => (old ? { ...old, data: edit(old.data) } : old));
}

// the issued secret is handed to the dialog once; the mutation must not keep it
const secretMutation = { gcTime: 0 } as const;

type CreateBody = { name: string; scopes: KeyScope[]; rate_limit: number };

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    ...secretMutation,
    mutationFn: (body: CreateBody) => apiClient.post<IssuedKey>('/keys', body),
    // the row goes in once the server made the key, never before: a refused
    // key would otherwise flash into the list and out again behind the dialog
    onSuccess: (issued) =>
      editKeys(qc, (rows) => [listed(issued), ...rows.filter((r) => r.id !== issued.id)]),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRotateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    ...secretMutation,
    mutationFn: ({ id, graceSeconds }: { id: string; graceSeconds: number }) =>
      apiClient.post<IssuedKey>(`/keys/${id}/rotate`, { grace_period_seconds: graceSeconds }),
    // show the new key and the old one's deadline now, the refetch confirms it
    onSuccess: (issued, { id, graceSeconds }) =>
      editKeys(qc, (rows) => [
        listed(issued),
        ...rows.flatMap((r) => {
          if (r.id !== id) return [r];
          if (graceSeconds === 0) return [];
          return [{ ...r, expires_at: issued.previous_key_expires_at ?? r.expires_at }];
        }),
      ]),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

/** Rename a key (PATCH /keys/:id, B-02). Its secret, scopes and limit stay. */
export function useRenameApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiClient.patch<ApiKeyRecord>(`/keys/${id}`, { name }),
    onSuccess: (updated) =>
      editKeys(qc, (rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

/**
 * Revoke a key. The row leaves when the server confirms, since the confirm
 * dialog waits for the answer and shows a refusal itself.
 */
export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/keys/${id}`),
    onSuccess: (_res, id) => editKeys(qc, (rows) => rows.filter((r) => r.id !== id)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

/** A key the rotation replaced: it works until `expires_at`, then drops off the list. */
export const isReplaced = (k: ApiKeyRecord) => k.expires_at !== null;
