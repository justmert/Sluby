import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  allowlistPins,
  apiKeys,
  legacyOwnerClaims,
  uploadSessions,
  userIdentities,
  users,
  videoAssets,
  webhookEndpoints,
} from '../schema.js';
import { userAddress } from '../../api/ownership.js';
import type { Account } from '../../api/auth/access.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getAccount(userId: string): Promise<Account | null> {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      identityId: userIdentities.id,
      provider: userIdentities.provider,
      subject: userIdentities.subject,
      username: userIdentities.username,
      pinned: allowlistPins.entry,
    })
    .from(users)
    .leftJoin(userIdentities, eq(userIdentities.userId, users.id))
    .leftJoin(
      allowlistPins,
      and(
        eq(allowlistPins.provider, userIdentities.provider),
        eq(allowlistPins.subject, userIdentities.subject),
      ),
    )
    .where(eq(users.id, userId));
  if (rows.length === 0) return null;

  const identities = new Map<string, Account['identities'][number]>();
  for (const r of rows) {
    if (!r.identityId || !r.provider || r.subject === null || r.username === null) continue;
    let identity = identities.get(r.identityId);
    if (!identity) {
      identity = {
        id: r.identityId,
        provider: r.provider,
        subject: r.subject,
        username: r.username,
        pinnedEntries: [],
      };
      identities.set(r.identityId, identity);
    }
    if (r.pinned !== null) identity.pinnedEntries.push(r.pinned);
  }
  return {
    id: rows[0].userId,
    displayName: rows[0].displayName,
    identities: [...identities.values()],
  };
}

/**
 * Move everything owned by any of `from` to `to`, in every table that stores
 * an owner address. Upload sessions keep theirs in metadata.
 */
async function moveOwnedRows(tx: Tx, from: string[], to: string): Promise<void> {
  if (from.length === 0) return;
  await tx
    .update(videoAssets)
    .set({ creatorAddress: to })
    .where(inArray(videoAssets.creatorAddress, from));
  await tx.update(apiKeys).set({ creatorAddress: to }).where(inArray(apiKeys.creatorAddress, from));
  await tx
    .update(webhookEndpoints)
    .set({ creatorAddress: to })
    .where(inArray(webhookEndpoints.creatorAddress, from));
  await tx
    .update(uploadSessions)
    .set({
      metadata: sql`jsonb_set(${uploadSessions.metadata}, '{creatorAddress}', to_jsonb(${to}::text))`,
    })
    .where(sql`${uploadSessions.metadata}->>'creatorAddress' in ${from}`);
}

// serialises concurrent sign-ins of one identity, so it is created once and
// its legacy data is claimed once
async function lockIdentity(tx: Tx, provider: string, subject: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`identity:${provider}:${subject}`}, 0))`,
  );
}

export type SignInDecision = { allowed: boolean; pin?: string };

export interface SignInInput {
  provider: string;
  subject: string;
  username: string;
  displayName: string;
  /**
   * The owner address an older version stored for this person. Claimed only
   * when this identity signs in for the first time, and only if no other
   * account claimed it before.
   */
  legacyAddress?: string;
  /** The allowlist decision, given the provider's pinned entries (entry to subject). */
  decide: (pins: ReadonlyMap<string, string>) => SignInDecision;
}

export type SignInResult =
  | { status: 'refused' }
  | { status: 'signed_in'; userId: string; identityId: string; displayName: string };

/**
 * Sign an identity in, in one transaction: apply the allowlist (recording a
 * pin when it takes a handle entry), find or create its account, claim its
 * legacy data on first sign-in, and move any rows still left under addresses
 * the account claimed earlier (a write that raced an earlier claim).
 */
export async function signInIdentity(input: SignInInput): Promise<SignInResult> {
  const { provider, subject } = input;
  return db.transaction(async (tx) => {
    await lockIdentity(tx, provider, subject);

    const pinRows = await tx
      .select({ entry: allowlistPins.entry, subject: allowlistPins.subject })
      .from(allowlistPins)
      .where(eq(allowlistPins.provider, provider));
    const pins = new Map(pinRows.map((p) => [p.entry, p.subject]));

    let decision = input.decide(pins);
    if (!decision.allowed) return { status: 'refused' as const };
    if (decision.pin) {
      const pinned = await tx
        .insert(allowlistPins)
        .values({ provider, entry: decision.pin, subject })
        .onConflictDoNothing()
        .returning({ entry: allowlistPins.entry });
      if (pinned.length === 0) {
        // another account took the entry since it was read; decide again
        const [row] = await tx
          .select({ subject: allowlistPins.subject })
          .from(allowlistPins)
          .where(and(eq(allowlistPins.provider, provider), eq(allowlistPins.entry, decision.pin)));
        pins.set(decision.pin, row.subject);
        decision = input.decide(pins);
        if (!decision.allowed) return { status: 'refused' as const };
      }
    }

    const [existing] = await tx
      .select({ id: userIdentities.id, userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)));

    let userId: string;
    let identityId: string;
    if (existing) {
      ({ userId, id: identityId } = existing);
      await tx
        .update(userIdentities)
        .set({ username: input.username, lastSignInAt: new Date() })
        .where(eq(userIdentities.id, identityId));
      await tx.update(users).set({ displayName: input.displayName }).where(eq(users.id, userId));
    } else {
      const [user] = await tx
        .insert(users)
        .values({ displayName: input.displayName })
        .returning({ id: users.id });
      userId = user.id;
      const [identity] = await tx
        .insert(userIdentities)
        .values({ userId, provider, subject, username: input.username })
        .returning({ id: userIdentities.id });
      identityId = identity.id;
      if (input.legacyAddress) {
        // the primary key makes the first claimant the only one, for good
        await tx
          .insert(legacyOwnerClaims)
          .values({ address: input.legacyAddress, userId })
          .onConflictDoNothing();
      }
    }

    const claimed = await tx
      .select({ address: legacyOwnerClaims.address })
      .from(legacyOwnerClaims)
      .where(eq(legacyOwnerClaims.userId, userId));
    await moveOwnedRows(
      tx,
      claimed.map((c) => c.address),
      userAddress(userId),
    );

    return { status: 'signed_in' as const, userId, identityId, displayName: input.displayName };
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
      .values({ displayName: input.displayName })
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

/** The account that claimed a legacy owner address, or null while it is unclaimed. */
export async function findLegacyClaim(address: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: legacyOwnerClaims.userId })
    .from(legacyOwnerClaims)
    .where(eq(legacyOwnerClaims.address, address));
  return row?.userId ?? null;
}

/** Whether an allowlist entry of `provider` is pinned to an account. */
export async function isAllowlistEntryPinned(provider: string, entry: string): Promise<boolean> {
  const [row] = await db
    .select({ entry: allowlistPins.entry })
    .from(allowlistPins)
    .where(and(eq(allowlistPins.provider, provider), eq(allowlistPins.entry, entry)));
  return Boolean(row);
}
