import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { userIdentities, users } from '../schema.js';
import type { Account, Role } from '../../api/auth/access.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getAccount(userId: string): Promise<Account | null> {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      role: users.role,
      disabledAt: users.disabledAt,
      identityId: userIdentities.id,
      provider: userIdentities.provider,
      subject: userIdentities.subject,
      username: userIdentities.username,
    })
    .from(users)
    .leftJoin(userIdentities, eq(userIdentities.userId, users.id))
    .where(eq(users.id, userId));
  if (rows.length === 0) return null;

  const identities: Account['identities'] = [];
  for (const r of rows) {
    if (!r.identityId || !r.provider || r.subject === null || r.username === null) continue;
    identities.push({
      id: r.identityId,
      provider: r.provider,
      subject: r.subject,
      username: r.username,
    });
  }
  return {
    id: rows[0].userId,
    displayName: rows[0].displayName,
    role: rows[0].role,
    disabledAt: rows[0].disabledAt,
    identities,
  };
}

// serialises concurrent sign-ins of one identity, so it is created once
async function lockIdentity(tx: Tx, provider: string, subject: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`identity:${provider}:${subject}`}, 0))`,
  );
}

export interface SignInInput {
  provider: string;
  subject: string;
  username: string;
  displayName: string;
}

export type SignInResult =
  /** `not_a_member`: nobody added this identity; `disabled`: an admin removed its account. */
  | { status: 'refused'; reason: 'not_a_member' | 'disabled' }
  | { status: 'signed_in'; userId: string; identityId: string; displayName: string };

/**
 * Sign in an identity that already belongs to a member, refreshing the
 * handle and name the provider reports now. Signing in never makes an
 * account: people join through an invite, so an identity nobody added is
 * refused, and so is the identity of a removed member.
 */
export async function signInIdentity(input: SignInInput): Promise<SignInResult> {
  const { provider, subject } = input;
  return db.transaction(async (tx) => {
    await lockIdentity(tx, provider, subject);
    const [existing] = await tx
      .select({
        id: userIdentities.id,
        userId: userIdentities.userId,
        disabledAt: users.disabledAt,
      })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)));
    if (!existing) return { status: 'refused' as const, reason: 'not_a_member' as const };
    if (existing.disabledAt) return { status: 'refused' as const, reason: 'disabled' as const };

    await tx
      .update(userIdentities)
      .set({ username: input.username, lastSignInAt: new Date() })
      .where(eq(userIdentities.id, existing.id));
    await tx
      .update(users)
      .set({ displayName: input.displayName })
      .where(eq(users.id, existing.userId));
    return {
      status: 'signed_in' as const,
      userId: existing.userId,
      identityId: existing.id,
      displayName: input.displayName,
    };
  });
}

/**
 * The account of an identity that never signs in through a provider (the
 * AUTH_DISABLED dev account), created on first use.
 */
export async function ensureIdentityAccount(input: {
  provider: string;
  subject: string;
  username: string;
  displayName: string;
  /** The role the account gets when it is created here. */
  role: Role;
}): Promise<{ userId: string; identityId: string }> {
  return db.transaction(async (tx) => {
    await lockIdentity(tx, input.provider, input.subject);
    const [existing] = await tx
      .select({ id: userIdentities.id, userId: userIdentities.userId })
      .from(userIdentities)
      .where(
        and(eq(userIdentities.provider, input.provider), eq(userIdentities.subject, input.subject)),
      );
    if (existing) return { userId: existing.userId, identityId: existing.id };
    const [user] = await tx
      .insert(users)
      .values({ displayName: input.displayName, role: input.role })
      .returning({ id: users.id });
    const [identity] = await tx
      .insert(userIdentities)
      .values({
        userId: user.id,
        provider: input.provider,
        subject: input.subject,
        username: input.username,
      })
      .returning({ id: userIdentities.id });
    return { userId: user.id, identityId: identity.id };
  });
}
