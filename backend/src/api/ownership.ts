/**
 * Multi-tenant ownership rules.
 *
 * Every resource is owned by the `creatorAddress` of the API key that
 * created it. Scope checks (`requireScope`) only prove a caller may perform
 * a KIND of action; they say nothing about WHOSE data it is. Any handler
 * that resolves a resource by id must additionally constrain the lookup to
 * the caller's owner, or one tenant can read and delete another tenant's
 * assets by guessing a UUID.
 *
 * One deliberate exception: a key seeded with the all-zero address is a
 * platform/superuser identity (see db/seed-api-key.ts, whose `--address`
 * defaults to it) and is allowed to act across tenants.
 */

/** The all-zero address that marks a platform (cross-tenant) API key. */
export const PLATFORM_ADDRESS = `0x${'0'.repeat(64)}`;

/**
 * Owner constraint for a request, given the caller's creator address.
 * Returns `undefined` for the platform identity, meaning "do not filter";
 * otherwise the address that queries must match.
 */
export function ownerFilter(creatorAddress: string | undefined): string | undefined {
  // Only the explicit platform address grants cross-tenant (unfiltered) access.
  // A genuinely absent identity (undefined, from internal callers) is also
  // unfiltered, but an empty string is NOT: it must scope to '' (matching no
  // real asset) so a stray empty address can never become a superuser.
  if (creatorAddress === undefined) return undefined;
  return creatorAddress === PLATFORM_ADDRESS ? undefined : creatorAddress;
}
