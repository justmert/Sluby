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
  /** Only on the stand-in row shown while the server creates the key. */
  pending?: true;
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
  return {
    id: k.id,
    name: k.name,
    scopes: k.scopes,
    rate_limit: k.rate_limit,
    is_active: k.is_active,
    created_at: k.created_at,
    expires_at: k.expires_at,
  };
}

function editKeys(qc: QueryClient, edit: (rows: ApiKeyRecord[]) => ApiKeyRecord[]) {
  qc.setQueryData<KeyList>(KEYS, (old) => (old ? { ...old, data: edit(old.data) } : old));
}

// the issued secret is handed to the dialog once; the mutation must not keep it
const secretMutation = { gcTime: 0 } as const;

let pendingSeq = 0;

type CreateBody = { name: string; scopes: KeyScope[]; rate_limit: number };

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    ...secretMutation,
    mutationFn: (body: CreateBody) => apiClient.post<IssuedKey>('/keys', body),
    // the list is newest first, so the stand-in goes on top where the key will land
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: KEYS });
      const id = `pending-${++pendingSeq}`;
      const row: ApiKeyRecord = {
        id,
        ...body,
        is_active: true,
        created_at: new Date().toISOString(),
        expires_at: null,
        pending: true,
      };
      editKeys(qc, (rows) => [row, ...rows]);
      return { id };
    },
    onSuccess: (issued, _body, ctx) =>
      editKeys(qc, (rows) => rows.map((r) => (r.id === ctx.id ? listed(issued) : r))),
    onError: (_err, _body, ctx) => {
      if (ctx) editKeys(qc, (rows) => rows.filter((r) => r.id !== ctx.id));
    },
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

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/keys/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEYS });
      const rows = qc.getQueryData<KeyList>(KEYS)?.data ?? [];
      const index = rows.findIndex((r) => r.id === id);
      const removed = index >= 0 ? rows[index] : null;
      editKeys(qc, (list) => list.filter((r) => r.id !== id));
      return { removed, index };
    },
    // put the key back where it was; a refetch would only move it there anyway
    onError: (_err, _id, ctx) => {
      if (!ctx?.removed) return;
      const back = ctx.removed;
      editKeys(qc, (rows) =>
        rows.some((r) => r.id === back.id)
          ? rows
          : [...rows.slice(0, ctx.index), back, ...rows.slice(ctx.index)],
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}
