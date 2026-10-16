import { LOCAL_PROVIDER, SIGN_IN_PROVIDERS, getProvider } from './providers/index.js';
import { userAddress, userIdFromAddress } from '../ownership.js';

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

/**
 * Whether the owner of an API key may still act, and the address it acts as.
 * Keys follow their account: taking a person off the allowlist stops their
 * keys on the next request, and putting them back restores them.
 *
 * - `user:<id>`: the account's allowlist decision.
 * - a legacy address (github:<login>) some account claimed: that account,
 *   acting as its own address (a key written under the old address while the
 *   claim ran still lands in the right place).
 * - an unclaimed legacy address: allowed while its handle is listed and not
 *   pinned to an account, or the provider is open.
 * - anything else is an operator-made owner (the bootstrap key's `platform`,
 *   the platform address, `db:seed-key --address`): no allowlist applies.
 */
export async function resolveKeyOwner(
  owner: string,
  deps: OwnerAccessDeps,
): Promise<{ allowed: boolean; address: string }> {
  const userId = userIdFromAddress(owner);
  if (userId) {
    const account = await deps.getAccount(userId);
    return { allowed: account !== null && isAccountAllowed(account), address: owner };
  }

  for (const provider of SIGN_IN_PROVIDERS) {
    const handle = provider.legacyHandle?.(owner);
    if (handle == null) continue;
    const claimant = await deps.findLegacyClaim(owner);
    if (claimant) {
      const account = await deps.getAccount(claimant);
      return {
        allowed: account !== null && isAccountAllowed(account),
        address: userAddress(claimant),
      };
    }
    const allowlist = provider.allowlist();
    if (allowlist.open) return { allowed: true, address: owner };
    const pinned = await deps.isAllowlistEntryPinned(provider.id, handle);
    return { allowed: allowlist.allowsUnclaimedHandle(handle, pinned), address: owner };
  }

  return { allowed: true, address: owner };
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
