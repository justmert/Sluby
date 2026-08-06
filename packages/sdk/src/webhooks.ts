// ---------------------------------------------------------------------------
// @sluby/sdk - WebhookManager
// ---------------------------------------------------------------------------

import type { WebhookEvent } from './types.js';

/**
 * Utilities for verifying incoming webhook signatures and parsing event
 * payloads.
 *
 * This manager is intentionally stateless -- it does not require API
 * credentials and can be used in serverless handlers or middleware
 * without instantiating the full SDK client.
 */
export class WebhookManager {
  // -----------------------------------------------------------------------
  // HMAC-SHA256 signature verification
  // -----------------------------------------------------------------------

  /**
   * Verify the HMAC-SHA256 signature of a webhook payload.
   *
   * The Sluby backend sends the signature in the
   * `X-Sluby-Signature` header, computed as:
   *
   *   HMAC-SHA256(payload, secret)
   *
   * and hex-encoded.
   *
   * This method uses the Web Crypto API (available in modern browsers,
   * Node 18+, Cloudflare Workers, Deno, etc.) to perform a
   * timing-safe comparison.
   *
   * @param payload   - The raw request body string.
   * @param signature - The hex-encoded HMAC signature from the header.
   * @param secret    - The webhook secret configured when creating the
   *                    endpoint.
   * @returns `true` if the signature is valid.
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    // Use Node.js built-in `crypto` module when available for synchronous
    // HMAC verification with `timingSafeEqual`.
    try {
      // If we are in Node.js we can use the synchronous createHmac path
      // with timing-safe comparison.
      if (
        typeof globalThis.process !== 'undefined' &&
        (globalThis.process as NodeJS.Process).versions?.node
      ) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeCrypto: typeof import('node:crypto') = require('node:crypto');
        const expected = nodeCrypto
          .createHmac('sha256', secret)
          .update(payload, 'utf8')
          .digest('hex');

        if (expected.length !== signature.length) {
          return false;
        }

        return nodeCrypto.timingSafeEqual(
          Buffer.from(expected, 'hex'),
          Buffer.from(signature, 'hex'),
        );
      }

      // Fallback: simple constant-time comparison for non-Node runtimes.
      // NOTE: This is a best-effort constant-time comparison.  For maximum
      // security, callers running outside Node.js should use the async
      // `verifySignatureAsync` method which leverages Web Crypto.
      return this._constantTimeEqual(this._hmacSha256Sync(payload, secret), signature);
    } catch {
      // If all else fails, fall back to the naive sync path.
      return this._constantTimeEqual(this._hmacSha256Sync(payload, secret), signature);
    }
  }

  // -----------------------------------------------------------------------
  // Async verification (Web Crypto API)
  // -----------------------------------------------------------------------

  /**
   * Async variant of `verifySignature` that uses the Web Crypto API.
   * Preferred in environments where `crypto.subtle` is available
   * (browsers, Cloudflare Workers, Deno).
   */
  async verifySignatureAsync(payload: string, signature: string, secret: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const sig = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(payload));

    const expected = this._bufferToHex(new Uint8Array(sig));
    return this._constantTimeEqual(expected, signature);
  }

  // -----------------------------------------------------------------------
  // Event parsing
  // -----------------------------------------------------------------------

  /**
   * Parse a raw webhook payload string into a typed `WebhookEvent`.
   *
   * @param payload - The JSON-encoded request body.
   */
  parseEvent(payload: string): WebhookEvent {
    const parsed = JSON.parse(payload);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.event !== 'string' ||
      typeof parsed.timestamp !== 'string'
    ) {
      throw new Error('Invalid webhook payload: missing required "event" or "timestamp" field.');
    }

    return {
      event: parsed.event as string,
      timestamp: parsed.timestamp as string,
      data: (parsed.data ?? {}) as Record<string, unknown>,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Constant-time string comparison to mitigate timing attacks.
   *
   * Both strings are expected to be hex-encoded and of equal length for
   * a valid comparison.
   */
  private _constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
      mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return mismatch === 0;
  }

  /**
   * Synchronous HMAC-SHA256 using Node.js `crypto` when available.
   * Returns a hex-encoded string.
   *
   * This is intentionally a best-effort fallback for non-Node
   * environments.  The async `verifySignatureAsync` method should be
   * preferred whenever possible.
   */
  private _hmacSha256Sync(data: string, key: string): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto: typeof import('node:crypto') = require('node:crypto');
      return nodeCrypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
    } catch {
      throw new Error(
        'Synchronous HMAC-SHA256 is only available in Node.js. ' +
          'Use verifySignatureAsync() in browser or edge environments.',
      );
    }
  }

  /**
   * Convert a Uint8Array to a hex-encoded string.
   */
  private _bufferToHex(buffer: Uint8Array): string {
    const hexChars: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      hexChars.push(buffer[i].toString(16).padStart(2, '0'));
    }
    return hexChars.join('');
  }
}
