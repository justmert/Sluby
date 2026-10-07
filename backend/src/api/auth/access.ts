import { LOCAL_PROVIDER, SIGN_IN_PROVIDERS, getProvider } from './providers/index.js';
import { userAddress, userIdFromAddress } from '../ownership.js';
import { isOperatorAccount } from './operators.js';

/** An account with every identity it signs in with and the allowlist entries pinned to each. */
export interface Account {
  id: string;
  displayName: string;
  identities: Array<{
    id: string;
    provider: string;
    subject: string;
    username: string;
    pinnedEntries: string[];
  }>;
}

/**
 * Whether an account may use the server now: one of its identities must pass
 * its provider's allowlist. The local dev account (AUTH_DISABLED) has no
 * allowlist; its keys keep working after sign-in is turned on, like keys an
 * operator seeds.
 */
export function isAccountAllowed(account: Account): boolean {
  return account.identities.some((identity) => {
    if (identity.provider === LOCAL_PROVIDER) return true;
    const provider = getProvider(identity.provider);
    if (!provider) return false;
    return provider.allowlist().allows(identity.subject, identity.pinnedEntries);
  });
}

export interface OwnerAccessDeps {
  getAccount: (userId: string) => Promise<Account | null>;
  /** The account that claimed a legacy owner address, or null while it is unclaimed. */
  findLegacyClaim: (address: string) => Promise<string | null>;
  isAllowlistEntryPinned: (provider: string, entry: string) => Promise<boolean>;
}

export interface KeyOwner {
  allowed: boolean;
  /** The address the key acts as. */
  address: string;
  /** Whether the key's account is an operator now, see operators.ts. */
  operator: boolean;
}

// a key acts for its account, so it carries the account's decisions as they
// stand at this request
function ownedByAccount(account: Account | null, address: string): KeyOwner {
  if (!account || !isAccountAllowed(account)) return { allowed: false, address, operator: false };
  return { allowed: true, address, operator: isOperatorAccount(account) };
}

/**
 * Whether the owner of an API key may still act, the address it acts as, and
 * whether it is an operator. Keys follow their account: taking a person off
 * the allowlist stops their keys on the next request, and putting them back
 * restores them; the operator list works the same way.
 *
 * - `user:<id>`: the account's allowlist and operator decisions.
 * - a legacy address (github:<login>) some account claimed: that account,
 *   acting as its own address (a key written under the old address while the
 *   claim ran still lands in the right place).
 * - an unclaimed legacy address: allowed while its handle is listed and not
 *   pinned to an account, or the provider is open. Never an operator: it names
 *   a handle only, no stable identity.
 * - anything else is an operator-made owner (the bootstrap key's `platform`,
 *   the platform address, `db:seed-key --address`): no allowlist applies, and
 *   no operator role (the platform address has its own, wider access).
 */
export async function resolveKeyOwner(owner: string, deps: OwnerAccessDeps): Promise<KeyOwner> {
  const userId = userIdFromAddress(owner);
  if (userId) return ownedByAccount(await deps.getAccount(userId), owner);

  for (const provider of SIGN_IN_PROVIDERS) {
    const handle = provider.legacyHandle?.(owner);
    if (handle == null) continue;
    const claimant = await deps.findLegacyClaim(owner);
    if (claimant) return ownedByAccount(await deps.getAccount(claimant), userAddress(claimant));
    const allowlist = provider.allowlist();
    if (allowlist.open) return { allowed: true, address: owner, operator: false };
    const pinned = await deps.isAllowlistEntryPinned(provider.id, handle);
    return {
      allowed: allowlist.allowsUnclaimedHandle(handle, pinned),
      address: owner,
      operator: false,
    };
  }

  return { allowed: true, address: owner, operator: false };
}

/**
 * The address that owns what was stored under `owner` now: a claimed legacy
 * address maps to its account's address, every other address to itself. For
 * owners written outside the database before a claim, such as an unfinished
 * tus upload's metadata on disk.
 */
export async function currentOwnerAddress(
  owner: string,
  deps: Pick<OwnerAccessDeps, 'findLegacyClaim'>,
): Promise<string> {
  if (userIdFromAddress(owner)) return owner;
  if (!SIGN_IN_PROVIDERS.some((p) => p.legacyHandle?.(owner) != null)) return owner;
  const claimant = await deps.findLegacyClaim(owner);
  return claimant ? userAddress(claimant) : owner;
}
