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
export const PENDING_INVITES_LEAD = 'Each link lets one person join and works for a week.';
