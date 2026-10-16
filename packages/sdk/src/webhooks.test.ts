import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookManager, type VerifyRequestOptions, type WebhookHeaders } from './webhooks.js';

function computeHmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

const manager = new WebhookManager();

describe('WebhookManager.verifySignature()', () => {
  const payload = '{"event":"video.ready","timestamp":"2025-01-01T00:00:00Z","data":{}}';
  const secret = 'whsec_test_secret_1234';
  const validSignature = computeHmac(payload, secret);

  it('should return true for a valid signature', () => {
    expect(manager.verifySignature(payload, validSignature, secret)).toBe(true);
  });

  it('should return false for an invalid signature', () => {
    const badSig = 'a'.repeat(validSignature.length);
    expect(manager.verifySignature(payload, badSig, secret)).toBe(false);
  });

  it('should return false when signature length differs', () => {
    expect(manager.verifySignature(payload, 'tooshort', secret)).toBe(false);
  });

  it('returns false for a non-hex signature of the right length instead of throwing', () => {
    const notHex = 'z'.repeat(validSignature.length);
    expect(manager.verifySignature(payload, notHex, secret)).toBe(false);
  });

  it('should return false for an empty signature', () => {
    expect(manager.verifySignature(payload, '', secret)).toBe(false);
  });

  it('should handle different secrets', () => {
    const otherSecret = 'whsec_other_secret';
    const otherSig = computeHmac(payload, otherSecret);

    // Valid with the correct secret
    expect(manager.verifySignature(payload, otherSig, otherSecret)).toBe(true);

    // Invalid with wrong secret
    expect(manager.verifySignature(payload, otherSig, secret)).toBe(false);
  });

  it('should handle different payloads', () => {
    const differentPayload = '{"event":"video.failed","timestamp":"2025-01-01","data":{}}';
    // The signature for the original payload should not match a different payload
    expect(manager.verifySignature(differentPayload, validSignature, secret)).toBe(false);
  });

  it('should handle empty payload', () => {
    const emptyPayloadSig = computeHmac('', secret);
    expect(manager.verifySignature('', emptyPayloadSig, secret)).toBe(true);
  });

  it('should handle unicode payload', () => {
    const unicodePayload = '{"event":"test","timestamp":"2025-01-01","data":{"name":"cafe\u0301"}}';
    const sig = computeHmac(unicodePayload, secret);
    expect(manager.verifySignature(unicodePayload, sig, secret)).toBe(true);
  });
});

describe('WebhookManager.verifySignatureAsync()', () => {
  const payload = '{"event":"video.ready","timestamp":"2025-01-01T00:00:00Z","data":{}}';
  const secret = 'whsec_test_secret_1234';
  const validSignature = computeHmac(payload, secret);

  it('should return true for a valid signature', async () => {
    const result = await manager.verifySignatureAsync(payload, validSignature, secret);
    expect(result).toBe(true);
  });

  it('should return false for an invalid signature', async () => {
    const badSig = 'b'.repeat(validSignature.length);
    const result = await manager.verifySignatureAsync(payload, badSig, secret);
    expect(result).toBe(false);
  });

  it('should return false when signature length differs', async () => {
    const result = await manager.verifySignatureAsync(payload, 'short', secret);
    expect(result).toBe(false);
  });

  it('should handle empty payload', async () => {
    const emptyPayloadSig = computeHmac('', secret);
    const result = await manager.verifySignatureAsync('', emptyPayloadSig, secret);
    expect(result).toBe(true);
  });

  it('should produce the same result as sync method', async () => {
    const syncResult = manager.verifySignature(payload, validSignature, secret);
    const asyncResult = await manager.verifySignatureAsync(payload, validSignature, secret);
    expect(syncResult).toBe(asyncResult);
  });

  it('accepts an uppercase hex signature, as the sync method does', async () => {
    const upper = validSignature.toUpperCase();
    expect(manager.verifySignature(payload, upper, secret)).toBe(true);
    expect(await manager.verifySignatureAsync(payload, upper, secret)).toBe(true);
  });
});

describe('WebhookManager.parseEvent()', () => {
  it('should parse a valid webhook event payload', () => {
    const payload = JSON.stringify({
      event: 'video.ready',
      timestamp: '2025-01-01T00:00:00Z',
      data: { videoAssetId: 'v1', status: 'ready' },
    });

    const event = manager.parseEvent(payload);
    expect(event.event).toBe('video.ready');
    expect(event.timestamp).toBe('2025-01-01T00:00:00Z');
    expect(event.data).toEqual({ videoAssetId: 'v1', status: 'ready' });
  });

  it('should default data to empty object when missing', () => {
    const payload = JSON.stringify({
      event: 'ping',
      timestamp: '2025-01-01T00:00:00Z',
    });

    const event = manager.parseEvent(payload);
    expect(event.data).toEqual({});
  });

  it('should throw when event field is missing', () => {
    const payload = JSON.stringify({
      timestamp: '2025-01-01T00:00:00Z',
      data: {},
    });

    expect(() => manager.parseEvent(payload)).toThrow(
      'Invalid webhook payload: missing required "event" or "timestamp" field.',
    );
  });

  it('should throw when timestamp field is missing', () => {
    const payload = JSON.stringify({
      event: 'test',
      data: {},
    });

    expect(() => manager.parseEvent(payload)).toThrow(
      'Invalid webhook payload: missing required "event" or "timestamp" field.',
    );
  });

  it('should throw when event is not a string', () => {
    const payload = JSON.stringify({
      event: 123,
      timestamp: '2025-01-01T00:00:00Z',
    });

    expect(() => manager.parseEvent(payload)).toThrow(
      'Invalid webhook payload: missing required "event" or "timestamp" field.',
    );
  });

  it('should throw when timestamp is not a string', () => {
    const payload = JSON.stringify({
      event: 'test',
      timestamp: 12345,
    });

    expect(() => manager.parseEvent(payload)).toThrow(
      'Invalid webhook payload: missing required "event" or "timestamp" field.',
    );
  });

  it('should throw for invalid JSON', () => {
    expect(() => manager.parseEvent('not json')).toThrow();
  });

  it('should throw for null payload', () => {
    expect(() => manager.parseEvent('null')).toThrow(
      'Invalid webhook payload: missing required "event" or "timestamp" field.',
    );
  });

  it('should throw for array payload', () => {
    expect(() => manager.parseEvent('[]')).toThrow(
      'Invalid webhook payload: missing required "event" or "timestamp" field.',
    );
  });

  it('should throw for primitive JSON payload', () => {
    expect(() => manager.parseEvent('"string"')).toThrow(
      'Invalid webhook payload: missing required "event" or "timestamp" field.',
    );
  });
});

describe('Constant-time comparison', () => {
  it('should reject signatures that differ by one character', () => {
    const payload = 'test-payload';
    const secret = 'my-secret';
    const validSig = computeHmac(payload, secret);

    // Modify the last character
    const lastChar = validSig[validSig.length - 1];
    const altChar = lastChar === 'a' ? 'b' : 'a';
    const badSig = validSig.slice(0, -1) + altChar;

    expect(manager.verifySignature(payload, badSig, secret)).toBe(false);
  });

  it('should reject signatures that differ by one character (first char)', () => {
    const payload = 'test-payload';
    const secret = 'my-secret';
    const validSig = computeHmac(payload, secret);

    const firstChar = validSig[0];
    const altChar = firstChar === 'a' ? 'b' : 'a';
    const badSig = altChar + validSig.slice(1);

    expect(manager.verifySignature(payload, badSig, secret)).toBe(false);
  });
});

describe('WebhookManager.verifyRequest()', () => {
  const body =
    '{"id":"evt_1","event":"asset.ready","timestamp":"2026-10-06T10:00:00.000Z","data":{}}';
  const secret = 'whsec_test_secret_1234';
  const now = 1_790_000_000;
  // the headers the backend sends, as node's req.headers gives them
  const sent = (timestamp: number, payload = body): Record<string, string> => ({
    'x-sluby-timestamp': String(timestamp),
    'x-sluby-signature-v1': computeHmac(`${timestamp}.${payload}`, secret),
    'x-sluby-signature': computeHmac(payload, secret),
  });

  type Verify = (
    p: string,
    h: WebhookHeaders,
    s: string,
    o?: VerifyRequestOptions,
  ) => Promise<boolean>;
  const variants: Array<[string, Verify]> = [
    ['sync', (p, h, s, o) => Promise.resolve(manager.verifyRequest(p, h, s, o))],
    ['async', (p, h, s, o) => manager.verifyRequestAsync(p, h, s, o)],
  ];

  describe.each(variants)('%s', (_name, verify) => {
    it('accepts a fresh request signed with the secret', async () => {
      expect(await verify(body, sent(now), secret, { now })).toBe(true);
    });

    it('accepts a fetch Headers object, any header case and an uppercase signature', async () => {
      expect(await verify(body, new Headers(sent(now)), secret, { now })).toBe(true);
      const upper = Object.fromEntries(
        Object.entries(sent(now)).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
      );
      expect(await verify(body, upper, secret, { now })).toBe(true);
    });

    it('refuses a replay older than the window, and one from the future', async () => {
      expect(await verify(body, sent(now - 301), secret, { now })).toBe(false);
      expect(await verify(body, sent(now + 301), secret, { now })).toBe(false);
      expect(await verify(body, sent(now - 300), secret, { now })).toBe(true);
      expect(await verify(body, sent(now - 3600), secret, { now, toleranceSeconds: 3600 })).toBe(
        true,
      );
    });

    it('refuses a timestamp moved without signing it again', async () => {
      const headers = { ...sent(now - 1000), 'x-sluby-timestamp': String(now) };
      expect(await verify(body, headers, secret, { now })).toBe(false);
    });

    it('refuses a changed body, a wrong secret and missing or malformed headers', async () => {
      expect(await verify(`${body} `, sent(now), secret, { now })).toBe(false);
      expect(await verify(body, sent(now), 'wrong', { now })).toBe(false);
      expect(await verify(body, {}, secret, { now })).toBe(false);
      const legacyOnly = { ...sent(now) };
      delete legacyOnly['x-sluby-signature-v1'];
      expect(await verify(body, legacyOnly, secret, { now })).toBe(false);
      const badTime = { ...sent(now), 'x-sluby-timestamp': '1.79e9' };
      expect(await verify(body, badTime, secret, { now })).toBe(false);
      const notHex = { ...sent(now), 'x-sluby-signature-v1': 'z'.repeat(64) };
      expect(await verify(body, notHex, secret, { now })).toBe(false);
    });

    it('uses the clock by default', async () => {
      const t = Math.floor(Date.now() / 1000);
      expect(await verify(body, sent(t), secret)).toBe(true);
      expect(await verify(body, sent(t - 600), secret)).toBe(false);
    });
  });
});

describe('WebhookManager.parseEvent() event ids', () => {
  it('returns the event id when the backend sent one', () => {
    const event = manager.parseEvent(
      '{"id":"evt_1","event":"asset.ready","timestamp":"2026-10-06T10:00:00Z","data":{}}',
    );
    expect(event.id).toBe('evt_1');
  });

  it('leaves it out for events from older backends', () => {
    const event = manager.parseEvent('{"event":"asset.ready","timestamp":"2026-10-06T10:00:00Z"}');
    expect(event).not.toHaveProperty('id');
  });
});
