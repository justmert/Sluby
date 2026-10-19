import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ApiKey, ApiKeyPage, ApiKeyScope, CreatedApiKey, RotatedApiKey } from '@sluby/sdk';
import { statusOf } from '@/lib/api-client';
import { sluby } from '@/lib/sluby';

export type KeyScope = ApiKeyScope;
/** The member who made a key. */
export type KeyCreator = { id: string; name: string };
/**
 * A key as listed. `createdBy` is null for a key made from the command line,
 * and undefined when the sdk in use does not pass the field on.
 */
export type ApiKeyRecord = ApiKey & { createdBy?: KeyCreator | null };
/** This server's limits on keys, to check a new key against. */
export type KeyLimits = ApiKeyPage['limits'];
/** A key right after creation or rotation: the listing plus its secret, shown once. */
export type IssuedKey = CreatedApiKey &
  Partial<Pick<RotatedApiKey, 'rotatedFrom' | 'previousKeyExpiresAt'>>;

type KeyList = { data: ApiKeyRecord[]; limits: KeyLimits };

const KEYS = ['api-keys'];

/** Every key of the account, following the cursor until the last page. */
async function listAllKeys(signal: AbortSignal): Promise<KeyList> {
  const data: ApiKeyRecord[] = [];
  let page = await sluby.keys.list({ signal });
  data.push(...page.data);
  const { limits } = page;
  while (page.hasMore && page.nextCursor) {
    page = await sluby.keys.list({ cursor: page.nextCursor, signal });
    data.push(...page.data);
  }
  return { data, limits };
}

export function useApiKeys() {
  return useQuery({
    queryKey: KEYS,
    queryFn: ({ signal }) => listAllKeys(signal),
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
    rateLimit: k.rateLimit,
    isActive: k.isActive,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    prefix: k.prefix,
    lastUsedAt: k.lastUsedAt,
    createdBy: k.createdBy,
  };
}

function editKeys(qc: QueryClient, edit: (rows: ApiKeyRecord[]) => ApiKeyRecord[]) {
  qc.setQueryData<KeyList>(KEYS, (old) => (old ? { ...old, data: edit(old.data) } : old));
}

// the issued secret is handed to the dialog once; the mutation must not keep it
const secretMutation = { gcTime: 0 } as const;

type CreateBody = { name: string; scopes: KeyScope[]; rateLimit: number };

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    ...secretMutation,
    mutationFn: (body: CreateBody): Promise<IssuedKey> => sluby.keys.create(body),
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
    mutationFn: ({ id, graceSeconds }: { id: string; graceSeconds: number }): Promise<IssuedKey> =>
      sluby.keys.rotate(id, { gracePeriodSeconds: graceSeconds }),
    // show the new key and the old one's deadline now, the refetch confirms it
    onSuccess: (issued, { id, graceSeconds }) =>
      editKeys(qc, (rows) => [
        listed(issued),
        ...rows.flatMap((r) => {
          if (r.id !== id) return [r];
          if (graceSeconds === 0) return [];
          return [{ ...r, expiresAt: issued.previousKeyExpiresAt ?? r.expiresAt }];
        }),
      ]),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

/** Rename a key (PATCH /keys/:id, B-02). Its secret, scopes and limit stay. */
export function useRenameApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => sluby.keys.update(id, { name }),
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
    mutationFn: async (id: string) => {
      try {
        await sluby.keys.revoke(id);
      } catch (err) {
        // revoked already, in another tab or by the api: what was asked is done
        if (statusOf(err) !== 404) throw err;
      }
    },
    onSuccess: (_res, id) => editKeys(qc, (rows) => rows.filter((r) => r.id !== id)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

/** A key the rotation replaced: it works until `expiresAt`, then drops off the list. */
export const isReplaced = (k: ApiKeyRecord) => k.expiresAt !== null;
