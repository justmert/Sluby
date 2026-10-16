import { and, eq, gt, isNull, lt, or, desc, isNotNull } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { studioSessions, type StudioSession } from '../schema.js';

export async function createStudioSession(data: {
  login: string;
  expiresAt: Date;
  userAgent: string | null;
}): Promise<StudioSession> {
  const [row] = await db.insert(studioSessions).values(data).returning();
  return row;
}

/** The session if it exists, has not been revoked and has not expired. */
export async function findActiveStudioSession(id: string): Promise<StudioSession | undefined> {
  const [row] = await db
    .select()
    .from(studioSessions)
    .where(
      and(
        eq(studioSessions.id, id),
        isNull(studioSessions.revokedAt),
        gt(studioSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row;
}

/** A login's live sessions, newest first. */
export async function listActiveStudioSessions(login: string): Promise<StudioSession[]> {
  return db
    .select()
    .from(studioSessions)
    .where(
      and(
        eq(studioSessions.login, login),
        isNull(studioSessions.revokedAt),
        gt(studioSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(studioSessions.createdAt));
}

/** End one of `login`'s sessions. False when it is not theirs or already ended. */
export async function revokeStudioSession(id: string, login: string): Promise<boolean> {
  const rows = await db
    .update(studioSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(studioSessions.id, id),
        eq(studioSessions.login, login),
        isNull(studioSessions.revokedAt),
      ),
    )
    .returning({ id: studioSessions.id });
  return rows.length > 0;
}

/** End every live session of `login`. Returns how many were ended. */
export async function revokeAllStudioSessions(login: string): Promise<number> {
  const rows = await db
    .update(studioSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(studioSessions.login, login), isNull(studioSessions.revokedAt)))
    .returning({ id: studioSessions.id });
  return rows.length;
}

/** Sessions that expired or were revoked before `olderThan`. */
const endedBefore = (olderThan: Date) =>
  or(
    lt(studioSessions.expiresAt, olderThan),
    and(isNotNull(studioSessions.revokedAt), lt(studioSessions.revokedAt, olderThan)),
  );

/**
 * Drop `login`'s sessions that expired or were revoked more than `olderThan`
 * ago. Run at sign-in, so a login's own list stays short.
 */
export async function pruneStudioSessions(login: string, olderThan: Date): Promise<void> {
  await db
    .delete(studioSessions)
    .where(and(eq(studioSessions.login, login), endedBefore(olderThan)));
}

/**
 * Drop every login's sessions that ended before `olderThan`, from the hourly
 * sweep: a login that never signs in again would otherwise keep its rows.
 * Returns how many were dropped.
 */
export async function pruneEndedStudioSessions(olderThan: Date): Promise<number> {
  const rows = await db
    .delete(studioSessions)
    .where(endedBefore(olderThan))
    .returning({ id: studioSessions.id });
  return rows.length;
}
