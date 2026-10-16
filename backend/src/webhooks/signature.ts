import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Generate an HMAC-SHA256 signature for a webhook payload, hex encoded.
 */
export function generateSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * The signature headers of one delivery attempt.
 *
 * - X-Sluby-Signature-V1: HMAC-SHA256 of `<timestamp>.<body>`, so a receiver
 *   that checks X-Sluby-Timestamp against its clock refuses a replayed
 *   request.
 * - X-Sluby-Signature: HMAC-SHA256 of the body alone, as before. Kept so
 *   receivers written against it keep working; it binds no time, so a
 *   captured request verifies forever. Deprecated.
 */
export function signatureHeaders(
  body: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const timestamp = String(nowSec);
  return {
    'X-Sluby-Timestamp': timestamp,
    'X-Sluby-Signature-V1': generateSignature(`${timestamp}.${body}`, secret),
    'X-Sluby-Signature': generateSignature(body, secret),
  };
}

/**
 * Verify a webhook signature using timing-safe comparison. Any string that is
 * not a hex digest of the right length is simply wrong, never an error.
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = generateSignature(payload, secret);
  if (signature.length !== expected.length || !/^[0-9a-f]+$/i.test(signature)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
