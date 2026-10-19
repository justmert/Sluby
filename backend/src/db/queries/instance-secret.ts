import { eq, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { instanceMeta } from '../schema.js';

const KEY = 'session_secret';

/**
 * The session secret this install keeps for itself when SESSION_SECRET is
 * unset outside production. The first start stores `candidate`; every later
 * start, and every other replica, gets the stored one back, so sessions,
 * signed URLs and the setup code survive a restart without anyone having to
 * generate a secret by hand. Production still requires SESSION_SECRET.
 */
export async function persistedSessionSecret(candidate: string): Promise<string> {
  await db
    .insert(instanceMeta)
    .values({ key: KEY, value: sql`to_jsonb(${candidate}::text)` })
    .onConflictDoNothing();
  const [row] = await db
    .select({ value: instanceMeta.value })
    .from(instanceMeta)
    .where(eq(instanceMeta.key, KEY));
  if (typeof row?.value !== 'string' || row.value.length < 32) {
    throw new Error('instance_meta holds no usable session secret');
  }
  return row.value;
}
