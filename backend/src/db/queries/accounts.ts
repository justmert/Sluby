import { and, eq, exists, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { passwordCredentials, userIdentities, users } from '../schema.js';
import type { Account, Role } from '../../api/auth/access.js';
import { LOCAL_PROVIDER } from '../../api/auth/providers/index.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** The provider of email and password sign-in in user_identities. */
export const PASSWORD_PROVIDER = 'password';

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
export async function lockIdentity(tx: Tx, provider: string, subject: string): Promise<void> {
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

/**
 * Serialises every change that could leave the workspace without an admin
 * (setup, role changes, removals), so two of them cannot each see another
 * admin and both go ahead.
 */
export async function lockAdmins(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('sluby:admins', 0))`);
}

/**
 * Whether some admin can sign in: not removed, and with a way to sign in.
 * The local dev account of an AUTH_DISABLED run is an admin with no way in
 * once sign-in is on, so it does not count.
 */
export async function hasSignInAdmin(
  exec: Executor = db,
  opts: { except?: string } = {},
): Promise<boolean> {
  const rows = await exec
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, 'admin'),
        isNull(users.disabledAt),
        opts.except === undefined ? undefined : ne(users.id, opts.except),
        exists(
          exec
            .select({ one: sql`1` })
            .from(userIdentities)
            .where(
              and(eq(userIdentities.userId, users.id), ne(userIdentities.provider, LOCAL_PROVIDER)),
            ),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface PasswordAccountInput {
  name: string;
  /** Already trimmed and lowercased. */
  email: string;
  passwordHash: string;
}

export type NewAccount = { userId: string; identityId: string };

/** Add the email and password way in to an account, unless another account has the email. */
export async function addPasswordIdentity(
  tx: Tx,
  userId: string,
  email: string,
  passwordHash: string,
): Promise<{ identityId: string } | 'email_taken'> {
  await lockIdentity(tx, 'password-email', email);
  const [taken] = await tx
    .select({ userId: passwordCredentials.userId })
    .from(passwordCredentials)
    .where(eq(passwordCredentials.email, email));
  if (taken) return 'email_taken';
  await tx.insert(passwordCredentials).values({ userId, email, passwordHash });
  const [identity] = await tx
    .insert(userIdentities)
    .values({ userId, provider: PASSWORD_PROVIDER, subject: userId, username: email })
    .returning({ id: userIdentities.id });
  return { identityId: identity.id };
}

/** A new member who signs in with an email and password. */
export async function insertPasswordAccount(
  tx: Tx,
  input: PasswordAccountInput & { role: Role },
): Promise<NewAccount | 'email_taken'> {
  // checked before the user row exists, so a taken email leaves nothing behind
  await lockIdentity(tx, 'password-email', input.email);
  const [taken] = await tx
    .select({ userId: passwordCredentials.userId })
    .from(passwordCredentials)
    .where(eq(passwordCredentials.email, input.email));
  if (taken) return 'email_taken';
  const [user] = await tx
    .insert(users)
    .values({ displayName: input.name, role: input.role })
    .returning({ id: users.id });
  const added = await addPasswordIdentity(tx, user.id, input.email, input.passwordHash);
  if (added === 'email_taken') throw new Error('The email was taken while its lock was held');
  return { userId: user.id, identityId: added.identityId };
}

export type FirstAdminResult =
  ({ status: 'created' } & NewAccount) | { status: 'admin_exists' } | { status: 'email_taken' };

/**
 * Make the first admin of an install, or of an upgraded one that has members
 * but no admin. Refused once an admin who can sign in exists, so the setup
 * code stops working the moment it was used.
 */
export async function createFirstAdmin(input: PasswordAccountInput): Promise<FirstAdminResult> {
  return db.transaction(async (tx) => {
    await lockAdmins(tx);
    if (await hasSignInAdmin(tx)) return { status: 'admin_exists' as const };
    const created = await insertPasswordAccount(tx, { ...input, role: 'admin' });
    if (created === 'email_taken') return { status: 'email_taken' as const };
    return { status: 'created' as const, ...created };
  });
}

export interface PasswordAccount {
  userId: string;
  identityId: string;
  passwordHash: string;
  disabled: boolean;
}

/** The account that signs in with `email` (lowercased), or null. */
export async function findPasswordAccount(email: string): Promise<PasswordAccount | null> {
  const [row] = await db
    .select({
      userId: passwordCredentials.userId,
      passwordHash: passwordCredentials.passwordHash,
      identityId: userIdentities.id,
      disabledAt: users.disabledAt,
    })
    .from(passwordCredentials)
    .innerJoin(users, eq(users.id, passwordCredentials.userId))
    .innerJoin(
      userIdentities,
      and(
        eq(userIdentities.userId, passwordCredentials.userId),
        eq(userIdentities.provider, PASSWORD_PROVIDER),
      ),
    )
    .where(eq(passwordCredentials.email, email));
  if (!row) return null;
  return {
    userId: row.userId,
    identityId: row.identityId,
    passwordHash: row.passwordHash,
    disabled: row.disabledAt !== null,
  };
}

/** Note a sign-in through an identity, for the members list. */
export async function recordSignIn(identityId: string): Promise<void> {
  await db
    .update(userIdentities)
    .set({ lastSignInAt: new Date() })
    .where(eq(userIdentities.id, identityId));
}

/** The email and password hash of an account, null when it has no password. */
export async function getPasswordCredential(
  userId: string,
): Promise<{ email: string; passwordHash: string } | null> {
  const [row] = await db
    .select({ email: passwordCredentials.email, passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials)
    .where(eq(passwordCredentials.userId, userId));
  return row ?? null;
}

/** Replace the password of an account that has one. */
export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await db
    .update(passwordCredentials)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(passwordCredentials.userId, userId));
}

export type LinkIdentityResult =
  { status: 'linked'; identityId: string } | { status: 'already_linked' };

/**
 * Add a provider identity to a signed-in member's account, so they can sign
 * in with it too. Refused when the identity belongs to another account;
 * linking one the account already has only refreshes its handle.
 */
export async function linkIdentity(
  userId: string,
  input: Omit<SignInInput, 'displayName'>,
): Promise<LinkIdentityResult> {
  return db.transaction(async (tx) => {
    await lockIdentity(tx, input.provider, input.subject);
    const [existing] = await tx
      .select({ id: userIdentities.id, userId: userIdentities.userId })
      .from(userIdentities)
      .where(
        and(eq(userIdentities.provider, input.provider), eq(userIdentities.subject, input.subject)),
      );
    if (existing && existing.userId !== userId) return { status: 'already_linked' as const };
    if (existing) {
      await tx
        .update(userIdentities)
        .set({ username: input.username })
        .where(eq(userIdentities.id, existing.id));
      return { status: 'linked' as const, identityId: existing.id };
    }
    const [identity] = await tx
      .insert(userIdentities)
      .values({
        userId,
        provider: input.provider,
        subject: input.subject,
        username: input.username,
      })
      .returning({ id: userIdentities.id });
    return { status: 'linked' as const, identityId: identity.id };
  });
}
