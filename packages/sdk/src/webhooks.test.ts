import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookManager } from './webhooks.js';

// ---------------------------------------------------------------------------
// Helper: compute a known-good HMAC-SHA256 hex digest
// ---------------------------------------------------------------------------

function computeHmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

const manager = new WebhookManager();

// ---------------------------------------------------------------------------
// Tests: verifySignature (sync, Node.js)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: verifySignatureAsync (Web Crypto API)
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// Tests: parseEvent()
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: constant-time comparison behavior
// ---------------------------------------------------------------------------

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
