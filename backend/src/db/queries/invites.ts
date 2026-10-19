import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { invites, passwordCredentials, studioSessions, userIdentities, users } from '../schema.js';
import type { Role } from '../../api/auth/access.js';
import { linkGone, type LinkGone } from '../../api/auth/link-token.js';
import {
  PASSWORD_PROVIDER,
  addPasswordIdentity,
  insertPasswordAccount,
  lockIdentity,
  type NewAccount,
  type PasswordAccountInput,
  type SignInInput,
} from './accounts.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An invite or reset link, as its token finds it. */
export interface LinkRecord {
  id: string;
  kind: 'invite' | 'reset';
  /** invite: the role the new member gets. */
  role: Role | null;
  /** reset: the member whose password it sets. */
  userId: string | null;
  /** reset: the email the member signs in with, null while they have no password. */
  email: string | null;
  /** reset: whether the member was removed. */
  userDisabled: boolean;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

const linkColumns = {
  id: invites.id,
  kind: invites.kind,
  role: invites.role,
  userId: invites.userId,
  email: passwordCredentials.email,
  disabledAt: users.disabledAt,
  expiresAt: invites.expiresAt,
  usedAt: invites.usedAt,
  revokedAt: invites.revokedAt,
};

function toLink(row: {
  id: string;
  kind: 'invite' | 'reset';
  role: Role | null;
  userId: string | null;
  email: string | null;
  disabledAt: Date | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}): LinkRecord {
  const { disabledAt, ...rest } = row;
  return { ...rest, userDisabled: disabledAt !== null };
}

export async function findLink(tokenHash: string): Promise<LinkRecord | null> {
  const [row] = await db
    .select(linkColumns)
    .from(invites)
    .leftJoin(users, eq(users.id, invites.userId))
    .leftJoin(passwordCredentials, eq(passwordCredentials.userId, invites.userId))
    .where(eq(invites.tokenHash, tokenHash));
  return row ? toLink(row) : null;
}

export type LinkRefusal = { status: 'not_found' } | { status: 'gone'; reason: LinkGone };

/**
 * Take a usable link of `kind` for this transaction: the row stays locked
 * until it commits, so two browsers using one link cannot both succeed.
 */
async function claimLink(
  tx: Tx,
  tokenHash: string,
  kind: LinkRecord['kind'],
): Promise<LinkRecord | LinkRefusal> {
  const [locked] = await tx
    .select({ id: invites.id })
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .for('update');
  if (!locked) return { status: 'not_found' };
  const [row] = await tx
    .select(linkColumns)
    .from(invites)
    .leftJoin(users, eq(users.id, invites.userId))
    .leftJoin(passwordCredentials, eq(passwordCredentials.userId, invites.userId))
    .where(eq(invites.id, locked.id));
  const link = toLink(row);
  if (link.kind !== kind) return { status: 'not_found' };
  const gone = linkGone(link);
  if (gone) return { status: 'gone', reason: gone };
  return link;
}

const isRefusal = (r: LinkRecord | LinkRefusal): r is LinkRefusal => 'status' in r;

async function markUsed(tx: Tx, id: string): Promise<void> {
  await tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, id));
}

export type AcceptInviteResult =
  LinkRefusal | { status: 'email_taken' } | ({ status: 'joined' } & NewAccount);

/** Join with an invite as a new member who signs in with an email and password. */
export async function acceptInvite(
  tokenHash: string,
  input: PasswordAccountInput,
): Promise<AcceptInviteResult> {
  return db.transaction(async (tx) => {
    const link = await claimLink(tx, tokenHash, 'invite');
    if (isRefusal(link)) return link;
    const created = await insertPasswordAccount(tx, { ...input, role: link.role ?? 'member' });
    if (created === 'email_taken') return { status: 'email_taken' as const };
    await markUsed(tx, link.id);
    return { status: 'joined' as const, ...created };
  });
}

export type JoinWithIdentityResult =
  LinkRefusal | { status: 'already_linked' } | ({ status: 'joined' } & NewAccount);

/**
 * Join with an invite as a new member who signs in through a provider. An
 * identity that already belongs to an account cannot join a second time; the
 * invite stays unused for someone else.
 */
export async function joinWithIdentity(
  tokenHash: string,
  input: SignInInput,
): Promise<JoinWithIdentityResult> {
  return db.transaction(async (tx) => {
    const link = await claimLink(tx, tokenHash, 'invite');
    if (isRefusal(link)) return link;
    await lockIdentity(tx, input.provider, input.subject);
    const [existing] = await tx
      .select({ id: userIdentities.id })
      .from(userIdentities)
      .where(
        and(eq(userIdentities.provider, input.provider), eq(userIdentities.subject, input.subject)),
      );
    if (existing) return { status: 'already_linked' as const };
    const [user] = await tx
      .insert(users)
      .values({ displayName: input.displayName, role: link.role ?? 'member' })
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
    await markUsed(tx, link.id);
    return { status: 'joined' as const, userId: user.id, identityId: identity.id };
  });
}

export type AcceptResetResult =
  | LinkRefusal
  | { status: 'disabled' }
  | { status: 'email_taken' }
  | ({ status: 'reset' } & NewAccount);

/**
 * Set a member's password from a reset link, replacing the one they had or
 * giving them their first (then `email` names the new way in). Every session
 * the member had ends, since whoever held the old password may hold one.
 */
export async function acceptReset(
  tokenHash: string,
  input: { email: string | null; passwordHash: string },
): Promise<AcceptResetResult> {
  return db.transaction(async (tx) => {
    const link = await claimLink(tx, tokenHash, 'reset');
    if (isRefusal(link)) return link;
    const userId = link.userId;
    if (!userId) throw new Error(`Reset link ${link.id} names no member`);
    if (link.userDisabled) return { status: 'disabled' as const };

    let identityId: string;
    if (link.email !== null) {
      await tx
        .update(passwordCredentials)
        .set({ passwordHash: input.passwordHash, updatedAt: new Date() })
        .where(eq(passwordCredentials.userId, userId));
      const [identity] = await tx
        .select({ id: userIdentities.id })
        .from(userIdentities)
        .where(
          and(eq(userIdentities.userId, userId), eq(userIdentities.provider, PASSWORD_PROVIDER)),
        );
      if (!identity) throw new Error(`Member ${userId} has a password but no password identity`);
      identityId = identity.id;
    } else {
      if (input.email === null) throw new Error('A first password needs an email');
      const added = await addPasswordIdentity(tx, userId, input.email, input.passwordHash);
      if (added === 'email_taken') return { status: 'email_taken' as const };
      identityId = added.identityId;
    }

    await tx
      .update(studioSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(studioSessions.userId, userId), isNull(studioSessions.revokedAt)));
    await markUsed(tx, link.id);
    return { status: 'reset' as const, userId, identityId };
  });
}

/** A pending invite as the members page lists it; its token is never shown again. */
export interface PendingInvite {
  id: string;
  role: Role;
  createdAt: Date;
  expiresAt: Date;
  createdBy: { id: string; name: string } | null;
}

/** Store a new invite; the caller made the token and keeps it. */
export async function createInvite(data: {
  tokenHash: string;
  role: Role;
  createdBy: string | null;
  expiresAt: Date;
}): Promise<{ id: string; createdAt: Date; expiresAt: Date }> {
  const [row] = await db
    .insert(invites)
    .values({ kind: 'invite', ...data })
    .returning({ id: invites.id, createdAt: invites.createdAt, expiresAt: invites.expiresAt });
  return row;
}

/** Store a reset link for member `userId`; null when there is no such member. */
export async function createResetLink(data: {
  tokenHash: string;
  userId: string;
  createdBy: string | null;
  expiresAt: Date;
}): Promise<{ id: string; expiresAt: Date } | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, data.userId));
    if (!user) return null;
    const [row] = await tx
      .insert(invites)
      .values({ kind: 'reset', ...data })
      .returning({ id: invites.id, expiresAt: invites.expiresAt });
    return row;
  });
}

const pending = and(
  eq(invites.kind, 'invite'),
  isNull(invites.usedAt),
  isNull(invites.revokedAt),
  gt(invites.expiresAt, sql`now()`),
);

/** Invites nobody used yet that still work, newest first. */
export async function listPendingInvites(): Promise<PendingInvite[]> {
  const rows = await db
    .select({
      id: invites.id,
      role: invites.role,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      creatorId: users.id,
      creatorName: users.displayName,
    })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.createdBy))
    .where(pending)
    .orderBy(desc(invites.createdAt), desc(invites.id));
  return rows.map((r) => ({
    id: r.id,
    role: r.role ?? 'member',
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    createdBy: r.creatorId && r.creatorName ? { id: r.creatorId, name: r.creatorName } : null,
  }));
}

/** Withdraw a pending invite. False when there is no pending invite with this id. */
export async function revokeInvite(id: string): Promise<boolean> {
  const rows = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, id), pending))
    .returning({ id: invites.id });
  return rows.length > 0;
}
