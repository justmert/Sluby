import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Role, SignInMethod } from '@/lib/session';

/** GET /members, one row. */
export interface Member {
  id: string;
  name: string;
  role: Role;
  status: 'active' | 'removed';
  sign_in: SignInMethod[];
  created_at: string;
  last_sign_in_at: string | null;
}

/** GET /invites, one row. The link itself is only shown when it is made. */
export interface PendingInvite {
  id: string;
  role: Role;
  created_at: string;
  expires_at: string;
  /** How many people may join with it; null until it expires or is revoked. */
  max_uses: number | null;
  /** How many people joined with it so far. */
  uses: number;
  created_by: { id: string; name: string } | null;
}

/** A new invite or reset link, shown once. */
export interface IssuedLink {
  url: string;
  expires_at: string;
}

export const MEMBERS_KEY = ['members'];
export const INVITES_KEY = ['invites'];

export function useMembers() {
  return useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: ({ signal }) =>
      apiClient.get<{ data: Member[] }>('/members', { signal }).then((r) => r.data),
  });
}

export function useInvites() {
  return useQuery({
    queryKey: INVITES_KEY,
    queryFn: ({ signal }) =>
      apiClient.get<{ data: PendingInvite[] }>('/invites', { signal }).then((r) => r.data),
  });
}

function putMember(qc: QueryClient, member: Member) {
  qc.setQueryData<Member[]>(MEMBERS_KEY, (rows) =>
    rows?.map((m) => (m.id === member.id ? member : m)),
  );
}

/** A change to one member that answers with the member as it is now. */
function useMemberChange<V>(request: (vars: V) => Promise<Member>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (member) => putMember(qc, member),
    onSettled: () => qc.invalidateQueries({ queryKey: MEMBERS_KEY }),
  });
}

export function useChangeRole() {
  return useMemberChange(({ id, role }: { id: string; role: Role }) =>
    apiClient.patch<Member>(`/members/${encodeURIComponent(id)}`, { role }),
  );
}

export function useRemoveMember() {
  return useMemberChange((id: string) =>
    apiClient.post<Member>(`/members/${encodeURIComponent(id)}/remove`),
  );
}

export function useRestoreMember() {
  return useMemberChange((id: string) =>
    apiClient.post<Member>(`/members/${encodeURIComponent(id)}/restore`),
  );
}

// a link signs someone in; the mutation must not keep it once it is shown
const linkMutation = { gcTime: 0 } as const;

export function useCreateResetLink() {
  return useMutation({
    ...linkMutation,
    mutationFn: (id: string) =>
      apiClient.post<IssuedLink>(`/members/${encodeURIComponent(id)}/reset-link`),
  });
}

/** What a new invite allows: who joins, how many people, for how long. */
export interface InviteOptions {
  role: Role;
  /** Null lets anyone with the link join until it expires; members only. */
  maxUses: number | null;
  expiresInDays: 1 | 7 | 30;
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    ...linkMutation,
    mutationFn: ({ role, maxUses, expiresInDays }: InviteOptions) =>
      apiClient.post<IssuedLink & { id: string; role: Role; max_uses: number | null }>('/invites', {
        role,
        max_uses: maxUses,
        expires_in_days: expiresInDays,
      }),
    // the listing has who made it and when, which the answer leaves out, so
    // the row comes from the server rather than being made up here
    onSettled: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: boolean }>(`/invites/${encodeURIComponent(id)}`),
    onSuccess: (_r, id) =>
      qc.setQueryData<PendingInvite[]>(INVITES_KEY, (rows) => rows?.filter((i) => i.id !== id)),
    onSettled: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}
