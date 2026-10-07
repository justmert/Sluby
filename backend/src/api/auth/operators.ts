import { env } from '../../config/env.js';
import { Allowlist } from './allowlist.js';
import { parseOperatorUsers } from './operator-list.js';
import { SIGN_IN_PROVIDERS, getProvider, type SignInProvider } from './providers/index.js';
import type { Account } from './access.js';

/**
 * The operator role. An operator sees what the platform identity sees of the
 * deployment's operations (full system status, process metrics, the whole
 * reconciliation report, starting a run) but stays an ordinary tenant for
 * data: ownerFilter still scopes every asset, key, webhook and upload to
 * their own account.
 *
 * OPERATOR_USERS (syntax in operator-list.ts) uses the allowlist rules of
 * each provider: `id:` entries match the stable subject, a handle entry
 * matches the account pinned to it in allowlist_pins. The pins are shared
 * with the sign-in allowlist, since both record the same fact (which account
 * held that handle when it was first seen), and a listed handle nobody has
 * pinned yet is pinned at its account's next sign-in. Like the allowlist it is
 * re-read on every request, so taking someone off the list ends their
 * operator view on their next request, sessions and keys alike.
 */

/** The operator entries of one provider as an allowlist, or null when it lists none. */
export function operatorAllowlist(provider: SignInProvider): Allowlist | null {
  const entries = parseOperatorUsers(env.OPERATOR_USERS).get(provider.id);
  // an empty Allowlist is open, which here would make everyone an operator
  if (!entries?.length) return null;
  return new Allowlist(entries.join(','), provider.normalizeHandle);
}

/**
 * Whether an account is an operator: one of its identities is listed, by its
 * subject or by a pinned handle. The local dev account is never listed; it is
 * the operator only while AUTH_DISABLED makes it the one user (see caller.ts).
 */
export function isOperatorAccount(account: Account): boolean {
  return account.identities.some((identity) => {
    const provider = getProvider(identity.provider);
    if (!provider) return false;
    return operatorAllowlist(provider)?.allows(identity.subject, identity.pinnedEntries) ?? false;
  });
}

/** Providers OPERATOR_USERS names that this build has no sign-in for; their entries match nobody. */
export function unknownOperatorProviders(
  providers: readonly SignInProvider[] = SIGN_IN_PROVIDERS,
): string[] {
  const known = new Set(providers.map((p) => p.id));
  return [...parseOperatorUsers(env.OPERATOR_USERS).keys()].filter((id) => !known.has(id));
}
