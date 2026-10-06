import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { generateSignature, signatureHeaders, verifySignature } from '../webhooks/signature.js';

describe('webhooks/signature', () => {
  const secret = 'test-secret-key';
  const payload = JSON.stringify({ event: 'upload.completed', data: { id: '123' } });

  describe('generateSignature', () => {
    it('should generate a valid HMAC-SHA256 hex signature', () => {
      const signature = generateSignature(payload, secret);

      // Verify it matches a manually computed HMAC
      const expected = createHmac('sha256', secret).update(payload).digest('hex');
      expect(signature).toBe(expected);
    });

    it('should return a 64-character hex string', () => {
      const signature = generateSignature(payload, secret);
      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different signatures for different payloads', () => {
      const sig1 = generateSignature('payload-1', secret);
      const sig2 = generateSignature('payload-2', secret);
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const sig1 = generateSignature(payload, 'secret-a');
      const sig2 = generateSignature(payload, 'secret-b');
      expect(sig1).not.toBe(sig2);
    });

    it('should handle empty payload', () => {
      const signature = generateSignature('', secret);
      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should handle empty secret', () => {
      const signature = generateSignature(payload, '');
      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('verifySignature', () => {
    it('should return true for a valid signature', () => {
      const signature = generateSignature(payload, secret);
      expect(verifySignature(payload, signature, secret)).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      const wrongSignature = 'a'.repeat(64);
      expect(verifySignature(payload, wrongSignature, secret)).toBe(false);
    });

    it('should return false when signature length differs', () => {
      // Signature is too short
      expect(verifySignature(payload, 'abc', secret)).toBe(false);
    });

    it('should return false when the wrong secret is used', () => {
      const signature = generateSignature(payload, secret);
      expect(verifySignature(payload, signature, 'wrong-secret')).toBe(false);
    });

    it('should return false when payload is tampered', () => {
      const signature = generateSignature(payload, secret);
      const tamperedPayload = payload + ' tampered';
      expect(verifySignature(tamperedPayload, signature, secret)).toBe(false);
    });

    it('returns false, not an error, for a non-hex signature of the right length', () => {
      expect(() => verifySignature(payload, 'z'.repeat(64), secret)).not.toThrow();
      expect(verifySignature(payload, 'z'.repeat(64), secret)).toBe(false);
      expect(verifySignature(payload, `${'a'.repeat(63)}g`, secret)).toBe(false);
    });

    it('accepts an uppercase hex signature', () => {
      expect(
        verifySignature(payload, generateSignature(payload, secret).toUpperCase(), secret),
      ).toBe(true);
    });

    it('should use timing-safe comparison (no early exit on mismatch)', () => {
      // We cannot directly test timing-safety, but we verify the function
      // handles the case where the first byte differs the same as
      // when the last byte differs (both should return false)
      const signature = generateSignature(payload, secret);
      const bytes = Buffer.from(signature, 'hex');

      // Flip the first byte
      bytes[0] ^= 0xff;
      const flippedFirst = bytes.toString('hex');
      expect(verifySignature(payload, flippedFirst, secret)).toBe(false);

      // Restore first byte, flip last byte
      bytes[0] ^= 0xff;
      bytes[bytes.length - 1] ^= 0xff;
      const flippedLast = bytes.toString('hex');
      expect(verifySignature(payload, flippedLast, secret)).toBe(false);
    });
  });

  describe('signatureHeaders', () => {
    it('signs the timestamp with the body (v1) and keeps the body-only signature', () => {
      const headers = signatureHeaders(payload, secret, 1767225600);
      expect(headers).toEqual({
        'X-Sluby-Timestamp': '1767225600',
        'X-Sluby-Signature-V1': createHmac('sha256', secret)
          .update(`1767225600.${payload}`)
          .digest('hex'),
        'X-Sluby-Signature': createHmac('sha256', secret).update(payload).digest('hex'),
      });
    });

    it('gives a different v1 signature at a different time, so an old one cannot be replayed', () => {
      const a = signatureHeaders(payload, secret, 1767225600);
      const b = signatureHeaders(payload, secret, 1767225601);
      expect(a['X-Sluby-Signature-V1']).not.toBe(b['X-Sluby-Signature-V1']);
      expect(a['X-Sluby-Signature']).toBe(b['X-Sluby-Signature']);
    });
  });
});
