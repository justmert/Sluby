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
   * Synchronous and Node.js only (node:crypto, timing-safe comparison), from
   * both the ESM and CommonJS builds. In browsers and edge runtimes use
   * `verifySignatureAsync`, which runs on Web Crypto.
   *
   * @param payload   - The raw request body string.
   * @param signature - The hex-encoded HMAC signature from the header.
   * @param secret    - The webhook secret configured when creating the
   *                    endpoint.
   * @returns `true` if the signature is valid.
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const nodeCrypto = loadNodeCrypto();
    if (!nodeCrypto) {
      throw new Error(
        'Synchronous signature verification needs Node.js. ' +
          'Use verifySignatureAsync() in browser or edge environments.',
      );
    }
    const expected = nodeCrypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    // timingSafeEqual throws on a length mismatch, and a non-hex signature
    // decodes to fewer bytes, so check the shape first
    if (signature.length !== expected.length || !/^[0-9a-f]+$/i.test(signature)) {
      return false;
    }
    return nodeCrypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
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

/**
 * node:crypto when running on Node, from either module format: the ESM build
 * has no `require`, so prefer process.getBuiltinModule (Node 20.16+) and fall
 * back to `require` for older Node in CommonJS.
 */
function loadNodeCrypto(): typeof import('node:crypto') | undefined {
  const proc = globalThis.process as
    (NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }) | undefined;
  if (!proc?.versions?.node) return undefined;
  if (typeof proc.getBuiltinModule === 'function') {
    return proc.getBuiltinModule('node:crypto') as typeof import('node:crypto');
  }
  if (typeof require === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:crypto') as typeof import('node:crypto');
  }
  return undefined;
}
