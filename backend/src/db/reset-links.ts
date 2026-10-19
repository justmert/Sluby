import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { passwordCredentials, users } from './schema.js';
import { createResetLink } from './queries/invites.js';
import { LINK_TTL_MS, newLinkToken, resetUrl } from '../api/auth/link-token.js';

export type ResetLinkOutcome =
  | { status: 'created'; name: string; url: string; expiresAt: Date }
  | { status: 'unknown_email' }
  | { status: 'removed'; name: string };

/**
 * A reset link for the account that signs in with `email`, made from the
 * server for an admin who is locked out. It has no creator: whoever can run
 * this on the server can do anything there anyway.
 */
export async function resetLinkForEmail(email: string): Promise<ResetLinkOutcome> {
  const normalised = email.trim().toLowerCase();
  const [account] = await db
    .select({ userId: users.id, name: users.displayName, disabledAt: users.disabledAt })
    .from(passwordCredentials)
    .innerJoin(users, eq(users.id, passwordCredentials.userId))
    .where(eq(passwordCredentials.email, normalised));
  if (!account) return { status: 'unknown_email' };
  // a removed member's reset link would be refused when used
  if (account.disabledAt) return { status: 'removed', name: account.name };

  const { token, tokenHash } = newLinkToken();
  const link = await createResetLink({
    tokenHash,
    userId: account.userId,
    createdBy: null,
    expiresAt: new Date(Date.now() + LINK_TTL_MS),
  });
  if (!link) throw new Error(`Member ${account.userId} was deleted while making the link`);
  return { status: 'created', name: account.name, url: resetUrl(token), expiresAt: link.expiresAt };
}
