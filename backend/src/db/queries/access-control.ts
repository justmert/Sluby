import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  allowlists,
  allowlistMembers,
  subscriptions,
  viewingTickets,
  type Allowlist,
  type NewAllowlist,
  type AllowlistMember,
  type Subscription,
  type NewSubscription,
  type ViewingTicket,
  type NewViewingTicket,
} from '../schema.js';

// ──────────────────────────────────────────
// Allowlists
// ──────────────────────────────────────────

export async function createAllowlistRecord(
  data: NewAllowlist,
): Promise<Allowlist> {
  const [record] = await db.insert(allowlists).values(data).returning();
  return record;
}

export async function listAllowlists(
  creatorAddress?: string,
): Promise<(Allowlist & { members: AllowlistMember[] })[]> {
  return db.query.allowlists.findMany({
    where: creatorAddress ? eq(allowlists.creatorAddress, creatorAddress) : undefined,
    with: { members: true },
    orderBy: [desc(allowlists.createdAt)],
  });
}

export async function getAllowlistById(
  id: string,
): Promise<(Allowlist & { members: AllowlistMember[] }) | undefined> {
  return db.query.allowlists.findFirst({
    where: eq(allowlists.id, id),
    with: { members: true },
  });
}

export async function deleteAllowlistRecord(id: string): Promise<void> {
  await db.delete(allowlists).where(eq(allowlists.id, id));
}

// ──────────────────────────────────────────
// Allowlist Members
// ──────────────────────────────────────────

export async function addAllowlistMemberRecord(
  allowlistId: string,
  address: string,
): Promise<AllowlistMember> {
  const [member] = await db
    .insert(allowlistMembers)
    .values({ allowlistId, address })
    .onConflictDoNothing()
    .returning();
  // If conflict (duplicate), return existing record
  if (!member) {
    const existing = await db.query.allowlistMembers.findFirst({
      where: and(
        eq(allowlistMembers.allowlistId, allowlistId),
        eq(allowlistMembers.address, address),
      ),
    });
    return existing!;
  }
  return member;
}

export async function removeAllowlistMemberRecord(
  allowlistId: string,
  address: string,
): Promise<void> {
  await db
    .delete(allowlistMembers)
    .where(
      and(
        eq(allowlistMembers.allowlistId, allowlistId),
        eq(allowlistMembers.address, address),
      ),
    );
}

// ──────────────────────────────────────────
// Subscriptions
// ──────────────────────────────────────────

export async function createSubscriptionRecord(
  data: NewSubscription,
): Promise<Subscription> {
  const [record] = await db.insert(subscriptions).values(data).returning();
  return record;
}

export async function listSubscriptions(
  creatorAddress?: string,
): Promise<Subscription[]> {
  return db.query.subscriptions.findMany({
    where: creatorAddress ? eq(subscriptions.creatorAddress, creatorAddress) : undefined,
    orderBy: [desc(subscriptions.createdAt)],
  });
}

// ──────────────────────────────────────────
// Viewing Tickets
// ──────────────────────────────────────────

export async function createViewingTicketRecord(
  data: NewViewingTicket,
): Promise<ViewingTicket> {
  const [record] = await db.insert(viewingTickets).values(data).returning();
  return record;
}

export async function listViewingTickets(
  creatorAddress?: string,
): Promise<ViewingTicket[]> {
  return db.query.viewingTickets.findMany({
    where: creatorAddress ? eq(viewingTickets.creatorAddress, creatorAddress) : undefined,
    orderBy: [desc(viewingTickets.createdAt)],
  });
}
