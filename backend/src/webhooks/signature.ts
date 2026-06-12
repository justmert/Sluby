import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Generate an HMAC-SHA256 signature for a webhook payload.
 */
export function generateSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify a webhook signature using timing-safe comparison.
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = generateSignature(payload, secret);

  if (signature.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}
