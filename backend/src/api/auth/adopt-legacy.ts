import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { allowlistPins, instanceMeta, userIdentities, users } from '../../db/schema.js';
import { disableMember, setMemberRole } from '../../db/queries/members.js';
import { Allowlist } from './allowlist.js';
import { parseOperatorUsers } from './operator-list.js';
import { getProvider } from './providers/index.js';

/**
 * Versions before membership decided who signs in with GITHUB_ALLOWED_USERS
 * and who sees operations data with OPERATOR_USERS. On the first start after
 * the upgrade those settings are applied once to the accounts that exist:
 * a GitHub account the allowlist would refuse is removed, and an account the
 * operator list names becomes an admin. From then on members and roles live
 * in the database only, and both settings are ignored.
 */

export const LEGACY_ADOPTED_KEY = 'legacy_access_adopted';

// any fixed number; replicas starting together adopt one after the other
const ADOPTION_LOCK_ID = 7_013_150_252;

export type AdoptionOutcome =
  { status: 'adopted'; removed: number; promoted: number } | { status: 'already_adopted' };

interface GithubAccount {
  userId: string;
  subject: string;
  username: string;
}

export async function adoptLegacyAccess(settings: {
  githubAllowedUsers: string;
  operatorUsers: string;
}): Promise<AdoptionOutcome> {
  const github = getProvider('github');
  if (!github) throw new Error('The github sign-in provider is missing from this build');

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADOPTION_LOCK_ID})`);
    const [done] = await tx
      .select({ key: instanceMeta.key })
      .from(instanceMeta)
      .where(eq(instanceMeta.key, LEGACY_ADOPTED_KEY));
    if (done) return { status: 'already_adopted' as const };

    // members only: an account removed earlier stays as it is
    const accounts: GithubAccount[] = await tx
      .select({
        userId: userIdentities.userId,
        subject: userIdentities.subject,
        username: userIdentities.username,
      })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(and(eq(userIdentities.provider, github.id), isNull(users.disabledAt)));
    const pinRows = await tx
      .select({ entry: allowlistPins.entry, subject: allowlistPins.subject })
      .from(allowlistPins)
      .where(eq(allowlistPins.provider, github.id));
    const pins = new Map(pinRows.map((p) => [p.entry, p.subject]));

    // decided as a sign-in by that account would have been decided, with the
    // handle it last signed in with, so an unpinned handle entry still counts
    const admitted = (list: Allowlist, a: GithubAccount) =>
      list.atSignIn(a.subject, a.username, pins).allowed;

    const removedIds = new Set<string>();
    const allowlist = new Allowlist(settings.githubAllowedUsers, github.normalizeHandle);
    if (!allowlist.open) {
      // an account with several github identities stays when any of them is admitted
      const kept = new Set(accounts.filter((a) => admitted(allowlist, a)).map((a) => a.userId));
      for (const a of accounts) {
        if (kept.has(a.userId) || removedIds.has(a.userId)) continue;
        await disableMember(a.userId, tx);
        removedIds.add(a.userId);
      }
    }

    const promotedIds = new Set<string>();
    const operatorEntries = parseOperatorUsers(settings.operatorUsers).get(github.id) ?? [];
    if (operatorEntries.length > 0) {
      const operators = new Allowlist(operatorEntries.join(','), github.normalizeHandle);
      for (const a of accounts) {
        if (removedIds.has(a.userId) || promotedIds.has(a.userId)) continue;
        if (!admitted(operators, a)) continue;
        await setMemberRole(a.userId, 'admin', tx);
        promotedIds.add(a.userId);
      }
    }

    const outcome = { removed: removedIds.size, promoted: promotedIds.size };
    await tx.insert(instanceMeta).values({
      key: LEGACY_ADOPTED_KEY,
      value: { ...outcome, adopted_at: new Date().toISOString() },
    });
    return { status: 'adopted' as const, ...outcome };
  });
}
