import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { studioSessions, userIdentities, users } from '../schema.js';
import type { Role } from '../../api/auth/access.js';
import { LOCAL_PROVIDER } from '../../api/auth/providers/index.js';
import { hasSignInAdmin, lockAdmins } from './accounts.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The pool or an open transaction, so a caller can make these part of its own. */
export type Executor = typeof db | Tx;

/** A member as the members page lists them. */
export interface MemberRecord {
  id: string;
  name: string;
  role: Role;
  disabledAt: Date | null;
  createdAt: Date;
  /** The latest sign-in through any of their identities, null when they have none. */
  lastSignInAt: Date | null;
  signIn: Array<{ provider: string; username: string }>;
}

async function loadMembers(exec: Executor, ids?: string[]): Promise<MemberRecord[]> {
  const rows = await exec
    .select({
      id: users.id,
      name: users.displayName,
      role: users.role,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
      provider: userIdentities.provider,
      username: userIdentities.username,
      lastSignInAt: userIdentities.lastSignInAt,
    })
    .from(users)
    .leftJoin(userIdentities, eq(userIdentities.userId, users.id))
    .where(ids ? inArray(users.id, ids) : undefined)
    .orderBy(asc(users.createdAt), asc(users.id), asc(userIdentities.createdAt));
  const byId = new Map<string, MemberRecord>();
  for (const r of rows) {
    let member = byId.get(r.id);
    if (!member) {
      member = {
        id: r.id,
        name: r.name,
        role: r.role,
        disabledAt: r.disabledAt,
        createdAt: r.createdAt,
        lastSignInAt: null,
        signIn: [],
      };
      byId.set(r.id, member);
    }
    if (r.provider === null || r.username === null) continue;
    member.signIn.push({ provider: r.provider, username: r.username });
    if (r.lastSignInAt && (!member.lastSignInAt || r.lastSignInAt > member.lastSignInAt)) {
      member.lastSignInAt = r.lastSignInAt;
    }
  }
  return [...byId.values()];
}

/** Every member, removed ones included, oldest first. */
export async function listMembers(): Promise<MemberRecord[]> {
  return loadMembers(db);
}

export async function getMember(id: string, exec: Executor = db): Promise<MemberRecord | null> {
  const [member] = await loadMembers(exec, [id]);
  return member ?? null;
}

/** Give a member a role, unguarded. False when there is no such member. */
export async function setMemberRole(
  userId: string,
  role: Role,
  exec: Executor = db,
): Promise<boolean> {
  const rows = await exec
    .update(users)
    .set({ role })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return rows.length > 0;
}

/**
 * Remove a member, unguarded: the row stays (their keys and history keep a
 * name) but they can no longer sign in, their keys stop, and every session
 * they have ends now rather than at its next request. False when there is no
 * such member; removing a removed member keeps the first removal time.
 */
export async function disableMember(userId: string, exec: Executor = db): Promise<boolean> {
  const [user] = await exec.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) return false;
  await exec
    .update(users)
    .set({ disabledAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.disabledAt)));
  await exec
    .update(studioSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(studioSessions.userId, userId), isNull(studioSessions.revokedAt)));
  return true;
}

/**
 * Whether taking `member` out of the admins would leave nobody who can sign
 * in as one. A removed admin, or one with no way to sign in, keeps nobody in.
 */
async function wouldStrandAdmins(tx: Tx, member: MemberRecord): Promise<boolean> {
  const keepsAdminsIn =
    member.role === 'admin' &&
    member.disabledAt === null &&
    member.signIn.some((s) => s.provider !== LOCAL_PROVIDER);
  if (!keepsAdminsIn) return false;
  return !(await hasSignInAdmin(tx, { except: member.id }));
}

export type MemberChange = MemberRecord | 'not_found' | 'last_admin';

/** Change a member's role; the last admin who can sign in stays an admin. */
export async function changeMemberRole(id: string, role: Role): Promise<MemberChange> {
  return db.transaction(async (tx) => {
    await lockAdmins(tx);
    const member = await getMember(id, tx);
    if (!member) return 'not_found' as const;
    if (member.role === role) return member;
    if (role !== 'admin' && (await wouldStrandAdmins(tx, member))) return 'last_admin' as const;
    await setMemberRole(id, role, tx);
    return (await getMember(id, tx))!;
  });
}

/** Remove a member (see disableMember); the last admin who can sign in stays. */
export async function removeMember(id: string): Promise<MemberChange> {
  return db.transaction(async (tx) => {
    await lockAdmins(tx);
    const member = await getMember(id, tx);
    if (!member) return 'not_found' as const;
    if (await wouldStrandAdmins(tx, member)) return 'last_admin' as const;
    await disableMember(id, tx);
    return (await getMember(id, tx))!;
  });
}

/** Let a removed member back in, with the role they had. */
export async function restoreMember(id: string): Promise<MemberRecord | 'not_found'> {
  const rows = await db
    .update(users)
    .set({ disabledAt: null })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (rows.length === 0) return 'not_found';
  return (await getMember(id))!;
}
