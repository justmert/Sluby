import { LOCAL_PROVIDER } from './providers/index.js';

export type Role = 'admin' | 'member';

/** A member of the workspace with every identity they sign in with. */
export interface Account {
  id: string;
  displayName: string;
  role: Role;
  /** When an admin removed the account, null while it is a member. */
  disabledAt: Date | null;
  identities: Array<{
    id: string;
    provider: string;
    subject: string;
    username: string;
  }>;
}

/**
 * Whether an account may use the server now: it was not removed. The local
 * dev account (AUTH_DISABLED) is always allowed, so its keys keep working
 * after sign-in is turned on, like keys made from the server.
 */
export function isAccountAllowed(account: Account): boolean {
  if (account.identities.some((i) => i.provider === LOCAL_PROVIDER)) return true;
  return account.disabledAt === null;
}

export interface OwnerAccessDeps {
  getAccount: (userId: string) => Promise<Account | null>;
}

export interface KeyOwner {
  allowed: boolean;
  /** Whether the key acts as an admin now. */
  admin: boolean;
  /** The member the key acts for, null for a key with no creator. */
  userId: string | null;
}

/**
 * Whether an API key may still act, and with which role. A key follows its
 * creator as they stand at this request: removing the member stops their
 * keys on the next request, restoring them brings the keys back, and a role
 * change applies at once.
 *
 * A key with no creator was made from the server (the bootstrap key,
 * `db:seed-key`) by someone who could do anything there anyway, so it acts as
 * an admin. A creator whose row is gone counts the same: the foreign key
 * clears created_by when a user row is deleted, and a lookup that races that
 * delete sees what the key will look like a moment later.
 */
export async function resolveKeyOwner(
  key: { createdBy: string | null },
  deps: OwnerAccessDeps,
): Promise<KeyOwner> {
  if (key.createdBy === null) return { allowed: true, admin: true, userId: null };
  const account = await deps.getAccount(key.createdBy);
  if (!account) return { allowed: true, admin: true, userId: null };
  if (!isAccountAllowed(account)) return { allowed: false, admin: false, userId: account.id };
  return { allowed: true, admin: account.role === 'admin', userId: account.id };
}
