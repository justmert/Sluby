import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-signed, expiring object URLs.
 *
 * The delivery gateway is unauthenticated so that public HLS plays from a
 * plain <video>/hls.js client. Private assets therefore need a capability
 * embedded in the URL itself: a signature over the object id and an expiry,
 * which the gateway verifies before serving bytes.
 *
 * The signature covers BOTH the object id and the expiry, so a signature
 * cannot be replayed against a different object, and the expiry cannot be
 * extended without invalidating it.
 */

export type SignatureFailure = 'missing' | 'expired' | 'invalid';

export interface VerifyResult {
  ok: boolean;
  reason?: SignatureFailure;
}

/** Deterministic HMAC-SHA256 over `objectId:expires`, hex encoded. */
export function signObjectAccess(
  objectId: string,
  expiresAtSec: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${objectId}:${expiresAtSec}`)
    .digest('hex');
}

/** Query string (`expires=...&sig=...`) granting timed access to an object. */
export function buildSignedObjectQuery(
  objectId: string,
  expiresAtSec: number,
  secret: string,
): string {
  const sig = signObjectAccess(objectId, expiresAtSec, secret);
  return `expires=${expiresAtSec}&sig=${sig}`;
}

/**
 * Verify a signed object request. `nowSec` is injected so the check is
 * deterministic in tests.
 */
export function verifyObjectAccess(
  objectId: string,
  expires: string | undefined,
  sig: string | undefined,
  secret: string,
  nowSec: number,
): VerifyResult {
  if (!expires || !sig) return { ok: false, reason: 'missing' };

  const expiresAtSec = Number(expires);
  if (!Number.isFinite(expiresAtSec)) return { ok: false, reason: 'invalid' };

  const expected = signObjectAccess(objectId, expiresAtSec, secret);
  const provided = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws on length mismatch, so guard first. A wrong-length
  // signature is simply invalid.
  if (provided.length !== expectedBuf.length) return { ok: false, reason: 'invalid' };
  if (!timingSafeEqual(provided, expectedBuf)) return { ok: false, reason: 'invalid' };

  // Only report expiry once the signature itself is known good, so the error
  // cannot be used to probe which object ids exist.
  if (nowSec > expiresAtSec) return { ok: false, reason: 'expired' };

  return { ok: true };
}
