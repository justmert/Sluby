import type { WebhookEvent } from './types.js';

/** Request headers as a Fetch `Headers` or as Node's `req.headers` record. */
export type WebhookHeaders =
  { get(name: string): string | null } | Record<string, string | string[] | undefined>;

export interface VerifyRequestOptions {
  /** How far X-Sluby-Timestamp may be from now, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** The current time in Unix seconds, for tests. Default: the clock. */
  now?: number;
}

/** The default replay window of `verifyRequest`, in seconds. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null }).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The signed string and signature of a v1 request, or null when the headers
 * are missing, malformed or the timestamp is outside the window.
 */
function signedV1(
  payload: string,
  headers: WebhookHeaders,
  options: VerifyRequestOptions,
): { signed: string; signature: string } | null {
  const timestamp = header(headers, 'x-sluby-timestamp');
  const signature = header(headers, 'x-sluby-signature-v1');
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return null;
  const tolerance = options.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > tolerance) return null;
  return { signed: `${timestamp}.${payload}`, signature: signature.toLowerCase() };
}

/**
 * Utilities for verifying incoming webhook signatures and parsing event
 * payloads.
 *
 * This manager is intentionally stateless: it does not require API
 * credentials and can be used in serverless handlers or middleware
 * without instantiating the full SDK client.
 */
export class WebhookManager {
  /**
   * Verify a webhook request: the `X-Sluby-Signature-V1` header must be the
   * hex HMAC-SHA256 of `<X-Sluby-Timestamp>.<raw body>` under the endpoint
   * secret, and the timestamp must be within `toleranceSeconds` (300 by
   * default) of now, so a captured request cannot be replayed later.
   *
   * Pass the raw body exactly as received, before any JSON parsing. Node.js
   * only, like `verifySignature`; use `verifyRequestAsync` elsewhere.
   *
   * @returns `true` if the request is authentic and fresh.
   */
  verifyRequest(
    payload: string,
    headers: WebhookHeaders,
    secret: string,
    options: VerifyRequestOptions = {},
  ): boolean {
    const v1 = signedV1(payload, headers, options);
    return v1 !== null && this.verifySignature(v1.signed, v1.signature, secret);
  }

  /** `verifyRequest` on the Web Crypto API, for browsers, edge runtimes and Deno. */
  async verifyRequestAsync(
    payload: string,
    headers: WebhookHeaders,
    secret: string,
    options: VerifyRequestOptions = {},
  ): Promise<boolean> {
    const v1 = signedV1(payload, headers, options);
    return v1 !== null && this.verifySignatureAsync(v1.signed, v1.signature, secret);
  }

  /**
   * Verify an HMAC-SHA256 signature of a string.
   *
   * Prefer `verifyRequest`. Called with the raw body and the
   * `X-Sluby-Signature` header, this checks the deprecated body-only
   * signature, which binds no time: a captured request keeps verifying
   * forever. The backend still sends that header for receivers written
   * against it.
   *
   * Synchronous and Node.js only (node:crypto, timing-safe comparison), from
   * both the ESM and CommonJS builds. In browsers and edge runtimes use
   * `verifySignatureAsync`, which runs on Web Crypto.
   *
   * @param payload   - The raw request body string.
   * @param signature - The hex-encoded HMAC signature from the header, in
   *                    either case.
   * @param secret    - The webhook secret configured when creating the
   *                    endpoint.
   * @returns `true` if the signature is valid.
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const nodeCrypto = loadNodeCrypto();
    if (!nodeCrypto) {
      throw new Error(
        'Synchronous signature verification needs Node.js 20.16+ or 22.3+ ' +
          '(process.getBuiltinModule). Use verifySignatureAsync() in browser or edge environments.',
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

  /**
   * Async variant of `verifySignature` that uses the Web Crypto API.
   * Prefer `verifyRequestAsync`, which also refuses replays.
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
    // hex is case-insensitive, and verifySignature accepts either case too
    return this._constantTimeEqual(expected, signature.toLowerCase());
  }

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
      // events from older backends have no id
      ...(typeof parsed.id === 'string' ? { id: parsed.id as string } : {}),
      event: parsed.event as string,
      timestamp: parsed.timestamp as string,
      data: (parsed.data ?? {}) as Record<string, unknown>,
    };
  }

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
 * node:crypto when running on Node, from either module format. The ESM build
 * has no `require` (and bundlers rewrite a guarded one into a throw), so this
 * uses process.getBuiltinModule, which every Node the package supports has
 * (20.16+ and 22.3+, see `engines`).
 */
function loadNodeCrypto(): typeof import('node:crypto') | undefined {
  const proc = globalThis.process as
    (NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }) | undefined;
  if (!proc?.versions?.node || typeof proc.getBuiltinModule !== 'function') return undefined;
  return proc.getBuiltinModule('node:crypto') as typeof import('node:crypto');
}
