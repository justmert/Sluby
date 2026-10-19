/**
 * Ownership rules.
 *
 * One install is one team's workspace: every asset, key, webhook and upload
 * carries the owner address `workspace`, and every caller (a member's Studio
 * session, a key, the AUTH_DISABLED dev account) acts as it. Handlers still
 * pass the caller's address through ownerFilter on every by-id lookup and
 * listing, so a row written under any other owner (which the 0022 migration
 * leaves none of) is never reachable, and an empty or stray address matches
 * nothing.
 *
 * What a caller may do is decided by its role instead (see auth/caller.ts):
 * admins also see deployment-wide operations data (full system status,
 * process metrics, the whole reconciliation run and starting one) and manage
 * members; members work with the library.
 */

/** The owner address of everything in this install. */
export const WORKSPACE_ADDRESS = 'workspace';

/** Whether a caller sees deployment-wide operations data: an admin. */
export function seesOperations(caller: { admin: boolean } | undefined): boolean {
  return caller?.admin ?? false;
}

/**
 * Owner constraint for a request, given the caller's creator address: the
 * address queries must match. Internal callers pass undefined and are not
 * filtered.
 */
export function ownerFilter(creatorAddress: string | undefined): string | undefined {
  // an empty string is not undefined: it scopes to '', which matches no row,
  // so a stray empty address can never see everything
  return creatorAddress;
}
