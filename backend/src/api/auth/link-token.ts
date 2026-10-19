import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * The tokens of invite and reset links. The token itself is shown once, in
 * the link; only its sha-256 is stored, so the invites table alone cannot be
 * used to join or to take over an account.
 */

/** How long an invite or reset link works. */
export const LINK_TTL_MS = 7 * 24 * 3600 * 1000;

// 32 random bytes in base64url, without padding
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Whether `token` could be one this server made; anything else is answered as unknown. */
export function isLinkToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_SHAPE.test(token);
}

const studioUrl = (path: string) => `${env.PUBLIC_URL.replace(/\/+$/, '')}/studio/${path}`;

/** The Studio page where a person joins with an invite. */
export const inviteUrl = (token: string) => studioUrl(`join/${token}`);

/** The Studio page where a member sets a new password. */
export const resetUrl = (token: string) => studioUrl(`reset/${token}`);

/** Why a link no longer works, or null while it does. */
export type LinkGone = 'used' | 'expired' | 'revoked';

export function linkGone(
  link: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now = new Date(),
): LinkGone | null {
  if (link.usedAt) return 'used';
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt <= now) return 'expired';
  return null;
}
