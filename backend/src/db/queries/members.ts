import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { studioSessions, users } from '../schema.js';
import type { Role } from '../../api/auth/access.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The pool or an open transaction, so a caller can make these part of its own. */
export type Executor = typeof db | Tx;

/** Give a member a role. False when there is no such member. */
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
 * Remove a member: the row stays (their keys and history keep a name) but
 * they can no longer sign in, their keys stop, and every session they have
 * ends now rather than at its next request. False when there is no such
 * member; removing a removed member keeps the first removal time.
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
