import { describe, it, expect } from 'vitest';
import {
  signObjectAccess,
  verifyObjectAccess,
  buildSignedObjectQuery,
} from '../delivery/signed-url.js';

const SECRET = 'test-secret-value-at-least-32-chars-long';
const OBJ = 'abc123def456';

describe('signObjectAccess', () => {
  it('is deterministic for the same object, expiry and secret', () => {
    expect(signObjectAccess(OBJ, 1800000000, SECRET)).toBe(
      signObjectAccess(OBJ, 1800000000, SECRET),
    );
  });

  it('changes when the object, the expiry, or the secret changes', () => {
    const base = signObjectAccess(OBJ, 1800000000, SECRET);
    expect(signObjectAccess('other', 1800000000, SECRET)).not.toBe(base);
    expect(signObjectAccess(OBJ, 1800000001, SECRET)).not.toBe(base);
    expect(signObjectAccess(OBJ, 1800000000, 'different-secret')).not.toBe(base);
  });
});

describe('verifyObjectAccess', () => {
  const expires = 1800000000;
  const sig = signObjectAccess(OBJ, expires, SECRET);

  it('accepts a valid, unexpired signature', () => {
    expect(verifyObjectAccess(OBJ, String(expires), sig, SECRET, expires - 10)).toEqual({
      ok: true,
    });
  });

  it('rejects a tampered signature', () => {
    const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
    expect(verifyObjectAccess(OBJ, String(expires), tampered, SECRET, expires - 10)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a signature minted for a different object', () => {
    const otherSig = signObjectAccess('another-object', expires, SECRET);
    expect(verifyObjectAccess(OBJ, String(expires), otherSig, SECRET, expires - 10)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects once the expiry has passed', () => {
    expect(verifyObjectAccess(OBJ, String(expires), sig, SECRET, expires + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects when expires or sig is missing', () => {
    expect(verifyObjectAccess(OBJ, undefined, sig, SECRET, expires - 10)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verifyObjectAccess(OBJ, String(expires), undefined, SECRET, expires - 10)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('rejects a non-numeric expires', () => {
    expect(verifyObjectAccess(OBJ, 'soon', sig, SECRET, expires - 10)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a wrong-length signature without throwing', () => {
    expect(verifyObjectAccess(OBJ, String(expires), 'abc', SECRET, expires - 10)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('buildSignedObjectQuery', () => {
  it('round-trips through verifyObjectAccess', () => {
    const q = buildSignedObjectQuery(OBJ, 1800000000, SECRET);
    const params = new URLSearchParams(q);
    expect(
      verifyObjectAccess(
        OBJ,
        params.get('expires') ?? undefined,
        params.get('sig') ?? undefined,
        SECRET,
        1799999000,
      ),
    ).toEqual({ ok: true });
  });
});
