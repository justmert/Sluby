import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  signObjectAccess,
  verifyObjectAccess,
  buildSignedObjectQuery,
  signManifestObjectUrls,
  MAX_SIGNED_URL_TTL_SEC,
  type SigningState,
} from '../delivery/signed-url.js';

const SECRET = 'test-secret-value-at-least-32-chars-long';
const OBJ = 'abc123def456';
const GEN0: SigningState = { generation: 0, legacyUntilSec: null };

/** Pull each `/v1/objects/{id}?...` URL out of a manifest for assertions. */
function objectUrls(text: string): Array<{ id: string; expires?: string; sig?: string }> {
  const out: Array<{ id: string; expires?: string; sig?: string }> = [];
  const re = /\/v1\/objects\/([^"\s?/]+)(\?[^"\s]*)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const params = new URLSearchParams((m[2] ?? '').replace(/^\?/, ''));
    out.push({
      id: m[1],
      expires: params.get('expires') ?? undefined,
      sig: params.get('sig') ?? undefined,
    });
  }
  return out;
}

/** How urls were signed before generations: the session secret over id and expiry. */
function legacySig(objectId: string, expires: number): string {
  return createHmac('sha256', SECRET).update(`${objectId}:${expires}`).digest('hex');
}

describe('signObjectAccess', () => {
  it('is deterministic for the same object, expiry, generation and secret', () => {
    expect(signObjectAccess(OBJ, 1800000000, 0, SECRET)).toBe(
      signObjectAccess(OBJ, 1800000000, 0, SECRET),
    );
  });

  it('changes when the object, the expiry, the generation or the secret changes', () => {
    const base = signObjectAccess(OBJ, 1800000000, 0, SECRET);
    expect(signObjectAccess('other', 1800000000, 0, SECRET)).not.toBe(base);
    expect(signObjectAccess(OBJ, 1800000001, 0, SECRET)).not.toBe(base);
    expect(signObjectAccess(OBJ, 1800000000, 1, SECRET)).not.toBe(base);
    expect(signObjectAccess(OBJ, 1800000000, 0, 'different-secret')).not.toBe(base);
  });

  it('uses a key derived for urls, never the session secret itself', () => {
    const sig = signObjectAccess(OBJ, 1800000000, 0, SECRET);
    for (const input of [`${OBJ}:1800000000`, `v2:${OBJ}:1800000000:0`]) {
      expect(sig).not.toBe(createHmac('sha256', SECRET).update(input).digest('hex'));
    }
  });
});

describe('verifyObjectAccess', () => {
  const expires = 1800000000;
  const now = expires - 10;
  const sig = signObjectAccess(OBJ, expires, 0, SECRET);

  it('accepts a valid, unexpired signature and reports its expiry', () => {
    expect(verifyObjectAccess(OBJ, String(expires), sig, GEN0, SECRET, now)).toEqual({
      ok: true,
      expiresAtSec: expires,
    });
  });

  it('rejects a tampered signature', () => {
    const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
    expect(verifyObjectAccess(OBJ, String(expires), tampered, GEN0, SECRET, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a signature minted for a different object', () => {
    const otherSig = signObjectAccess('another-object', expires, 0, SECRET);
    expect(verifyObjectAccess(OBJ, String(expires), otherSig, GEN0, SECRET, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a signature of an older generation once the asset revoked it', () => {
    const raised: SigningState = { generation: 1, legacyUntilSec: null };
    expect(verifyObjectAccess(OBJ, String(expires), sig, raised, SECRET, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const fresh = signObjectAccess(OBJ, expires, 1, SECRET);
    expect(verifyObjectAccess(OBJ, String(expires), fresh, raised, SECRET, now).ok).toBe(true);
  });

  it('rejects once the expiry has passed', () => {
    expect(verifyObjectAccess(OBJ, String(expires), sig, GEN0, SECRET, expires + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a good signature whose expiry lies past the six-hour cap', () => {
    const far = now + MAX_SIGNED_URL_TTL_SEC + 1;
    const farSig = signObjectAccess(OBJ, far, 0, SECRET);
    expect(verifyObjectAccess(OBJ, String(far), farSig, GEN0, SECRET, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const atCap = now + MAX_SIGNED_URL_TTL_SEC;
    const capSig = signObjectAccess(OBJ, atCap, 0, SECRET);
    expect(verifyObjectAccess(OBJ, String(atCap), capSig, GEN0, SECRET, now).ok).toBe(true);
  });

  it('rejects when expires or sig is missing', () => {
    expect(verifyObjectAccess(OBJ, undefined, sig, GEN0, SECRET, now)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verifyObjectAccess(OBJ, String(expires), undefined, GEN0, SECRET, now)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('rejects an expires that is not a plain whole number', () => {
    for (const bad of ['soon', '1e9', '-5', '1800000000.5', ' 1800000000']) {
      expect(verifyObjectAccess(OBJ, bad, sig, GEN0, SECRET, now)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  it('rejects a wrong-length signature without throwing', () => {
    expect(verifyObjectAccess(OBJ, String(expires), 'abc', GEN0, SECRET, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  describe('urls signed before generations existed', () => {
    // a ten-year link of the old scheme, the kind the audit minted
    const longExpiry = now + 10 * 365 * 86400;
    const old = legacySig(OBJ, longExpiry);

    it('verify only inside the asset legacy window, signing children no further', () => {
      const state: SigningState = { generation: 0, legacyUntilSec: now + 3600 };
      expect(verifyObjectAccess(OBJ, String(longExpiry), old, state, SECRET, now)).toEqual({
        ok: true,
        expiresAtSec: now + 3600,
      });
      expect(verifyObjectAccess(OBJ, String(longExpiry), old, state, SECRET, now + 3601)).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    it('keep their own, earlier expiry', () => {
      const state: SigningState = { generation: 0, legacyUntilSec: now + 3600 };
      const soon = now + 600;
      expect(
        verifyObjectAccess(OBJ, String(soon), legacySig(OBJ, soon), state, SECRET, now),
      ).toEqual({ ok: true, expiresAtSec: soon });
      expect(
        verifyObjectAccess(OBJ, String(soon), legacySig(OBJ, soon), state, SECRET, soon + 1),
      ).toEqual({ ok: false, reason: 'expired' });
    });

    it('are refused on an asset with no window (new, or revoked since)', () => {
      expect(verifyObjectAccess(OBJ, String(longExpiry), old, GEN0, SECRET, now)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });
  });
});

describe('buildSignedObjectQuery', () => {
  it('round-trips through verifyObjectAccess', () => {
    const q = buildSignedObjectQuery(OBJ, 1800000000, 3, SECRET);
    const params = new URLSearchParams(q);
    expect(
      verifyObjectAccess(
        OBJ,
        params.get('expires') ?? undefined,
        params.get('sig') ?? undefined,
        { generation: 3, legacyUntilSec: null },
        SECRET,
        1799999000,
      ),
    ).toEqual({ ok: true, expiresAtSec: 1800000000 });
  });
});

describe('signManifestObjectUrls', () => {
  const EXPIRES = 1800000000;
  const ok = { ok: true, expiresAtSec: EXPIRES };

  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    'https://cdn.example/v1/objects/variant360',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720',
    'https://cdn.example/v1/objects/variant720',
    '',
  ].join('\n');

  const variant = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="https://cdn.example/v1/objects/data720",BYTERANGE="800@0"',
    '#EXTINF:6.0,',
    '#EXT-X-BYTERANGE:120000@800',
    'https://cdn.example/v1/objects/data720',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

  it('signs every child object URL so each one verifies at that expiry and generation', () => {
    const signed = signManifestObjectUrls(master, EXPIRES, 2, SECRET);
    const urls = objectUrls(signed);
    const state = { generation: 2, legacyUntilSec: null };

    expect(urls.map((u) => u.id)).toEqual(['variant360', 'variant720']);
    for (const u of urls) {
      expect(u.expires).toBe(String(EXPIRES));
      expect(verifyObjectAccess(u.id, u.expires, u.sig, state, SECRET, EXPIRES - 1)).toEqual(ok);
      // and stop verifying once the generation moves on
      expect(
        verifyObjectAccess(u.id, u.expires, u.sig, { ...state, generation: 3 }, SECRET, EXPIRES - 1)
          .ok,
      ).toBe(false);
    }
  });

  it('signs both the EXT-X-MAP URI and the bare media line, preserving other attributes', () => {
    const signed = signManifestObjectUrls(variant, EXPIRES, 0, SECRET);

    // BYTERANGE and playlist directives are untouched.
    expect(signed).toContain('BYTERANGE="800@0"');
    expect(signed).toContain('#EXT-X-BYTERANGE:120000@800');
    expect(signed).toContain('#EXTINF:6.0,');

    // Both references to the data object are signed and verify.
    const urls = objectUrls(signed);
    expect(urls).toHaveLength(2);
    for (const u of urls) {
      expect(u.id).toBe('data720');
      expect(verifyObjectAccess(u.id, u.expires, u.sig, GEN0, SECRET, EXPIRES - 1)).toEqual(ok);
    }
  });

  it('appends with & when the URL already carries a query', () => {
    const withType = 'https://cdn.example/v1/objects/variant360?type=manifest';
    const signed = signManifestObjectUrls(withType, EXPIRES, 0, SECRET);
    expect(signed).toContain('?type=manifest&expires=');
    const [u] = objectUrls(signed);
    expect(verifyObjectAccess(u.id, u.expires, u.sig, GEN0, SECRET, EXPIRES - 1)).toEqual(ok);
  });

  it('leaves a manifest with no object URLs unchanged', () => {
    const plain = '#EXTM3U\n#EXT-X-ENDLIST\n';
    expect(signManifestObjectUrls(plain, EXPIRES, 0, SECRET)).toBe(plain);
  });

  it('does not double-sign an already signed URL', () => {
    const once = signManifestObjectUrls(master, EXPIRES, 0, SECRET);
    const twice = signManifestObjectUrls(once, EXPIRES, 0, SECRET);
    expect(twice).toBe(once);
  });
});
