import { formatDate } from '@/lib/formatters';
import type { Role } from '@/lib/session';

/** "Oct 26, 2026 at 3:04 PM", when a link stops working. */
export function linkExpiry(iso: string): string {
  const time = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${formatDate(iso)} at ${time}`;
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', member: 'Member' };

/** What each role may do, for the role pickers. */
export const ROLE_DETAIL: Record<Role, string> = {
  member: 'Uploads and manages videos, API keys and webhooks.',
  admin: 'Also manages members and sees server health and metrics.',
};

/** The line under the pending invites heading, on the page and its skeleton. */
export const PENDING_INVITES_LEAD =
  'Links show here until they are used up, expire or are revoked.';

/** How long a new invite link can work. */
export const INVITE_DAYS = [1, 7, 30] as const;
export type InviteDays = (typeof INVITE_DAYS)[number];
export const INVITE_DAYS_LABEL: Record<InviteDays, string> = {
  1: '1 day',
  7: '7 days',
  30: '30 days',
};

/** The most people one invite link can be limited to; the server refuses more. */
export const MAX_INVITE_USES = 1000;

/** How many joined with an invite: "0 of 1", "3 of 10", "5 (no limit)". */
export function inviteUses(uses: number, max: number | null): string {
  return max === null ? `${uses} (no limit)` : `${uses} of ${max}`;
}
