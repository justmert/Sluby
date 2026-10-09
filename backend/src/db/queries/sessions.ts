import { and, eq, gt, isNull, lt, or, desc, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { studioSessions, type StudioSession } from '../schema.js';
import { SESSION_SEEN_INTERVAL_MS } from '../../api/auth/session.js';

export async function createStudioSession(data: {
  userId: string;
  identityId: string;
  expiresAt: Date;
  userAgent: string | null;
}): Promise<StudioSession> {
  const [row] = await db.insert(studioSessions).values(data).returning();
  return row;
}

/** The session in whatever state, revoked and expired included. */
export async function findStudioSession(id: string): Promise<StudioSession | undefined> {
  const [row] = await db.select().from(studioSessions).where(eq(studioSessions.id, id)).limit(1);
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

/**
 * Mark a session as used now, unless that was recorded in the last five
 * minutes. The condition keeps concurrent requests from all writing.
 */
export async function markStudioSessionSeen(id: string): Promise<void> {
  const interval = `${SESSION_SEEN_INTERVAL_MS} milliseconds`;
  await db
    .update(studioSessions)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(studioSessions.id, id),
        or(
          isNull(studioSessions.lastSeenAt),
          sql`${studioSessions.lastSeenAt} < now() - ${interval}::interval`,
        ),
      ),
    );
}

/** An account's live sessions, newest first. */
export async function listActiveStudioSessions(userId: string): Promise<StudioSession[]> {
  return db
    .select()
    .from(studioSessions)
    .where(
      and(
        eq(studioSessions.userId, userId),
        isNull(studioSessions.revokedAt),
        gt(studioSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(studioSessions.createdAt));
}

/** End one of an account's sessions. False when it is not theirs or already ended. */
export async function revokeStudioSession(id: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(studioSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(studioSessions.id, id),
        eq(studioSessions.userId, userId),
        isNull(studioSessions.revokedAt),
      ),
    )
    .returning({ id: studioSessions.id });
  return rows.length > 0;
}

/** End every live session of an account. Returns how many were ended. */
export async function revokeAllStudioSessions(userId: string): Promise<number> {
  const rows = await db
    .update(studioSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(studioSessions.userId, userId), isNull(studioSessions.revokedAt)))
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
 * Drop an account's sessions that expired or were revoked more than
 * `olderThan` ago. Run at sign-in, so an account's own list stays short.
 */
export async function pruneStudioSessions(userId: string, olderThan: Date): Promise<void> {
  await db
    .delete(studioSessions)
    .where(and(eq(studioSessions.userId, userId), endedBefore(olderThan)));
}

/**
 * Drop every account's sessions that ended before `olderThan`, from the hourly
 * sweep: an account that never signs in again would otherwise keep its rows.
 * Returns how many were dropped.
 */
export async function pruneEndedStudioSessions(olderThan: Date): Promise<number> {
  const rows = await db
    .delete(studioSessions)
    .where(endedBefore(olderThan))
    .returning({ id: studioSessions.id });
  return rows.length;
}
