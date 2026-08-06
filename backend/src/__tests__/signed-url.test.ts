import { describe, it, expect } from 'vitest';
import {
  signObjectAccess,
  verifyObjectAccess,
  buildSignedObjectQuery,
  signManifestObjectUrls,
} from '../delivery/signed-url.js';

const SECRET = 'test-secret-value-at-least-32-chars-long';
const OBJ = 'abc123def456';

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

describe('signManifestObjectUrls', () => {
  const EXPIRES = 1800000000;

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

  it('signs every child object URL so each one verifies at that expiry', () => {
    const signed = signManifestObjectUrls(master, EXPIRES, SECRET);
    const urls = objectUrls(signed);

    expect(urls.map((u) => u.id)).toEqual(['variant360', 'variant720']);
    for (const u of urls) {
      expect(u.expires).toBe(String(EXPIRES));
      expect(
        verifyObjectAccess(u.id, u.expires, u.sig, SECRET, EXPIRES - 1),
      ).toEqual({ ok: true });
    }
  });

  it('signs both the EXT-X-MAP URI and the bare media line, preserving other attributes', () => {
    const signed = signManifestObjectUrls(variant, EXPIRES, SECRET);

    // BYTERANGE and playlist directives are untouched.
    expect(signed).toContain('BYTERANGE="800@0"');
    expect(signed).toContain('#EXT-X-BYTERANGE:120000@800');
    expect(signed).toContain('#EXTINF:6.0,');

    // Both references to the data object are signed and verify.
    const urls = objectUrls(signed);
    expect(urls).toHaveLength(2);
    for (const u of urls) {
      expect(u.id).toBe('data720');
      expect(
        verifyObjectAccess(u.id, u.expires, u.sig, SECRET, EXPIRES - 1),
      ).toEqual({ ok: true });
    }
  });

  it('appends with & when the URL already carries a query', () => {
    const withType = 'https://cdn.example/v1/objects/variant360?type=manifest';
    const signed = signManifestObjectUrls(withType, EXPIRES, SECRET);
    expect(signed).toContain('?type=manifest&expires=');
    const [u] = objectUrls(signed);
    expect(verifyObjectAccess(u.id, u.expires, u.sig, SECRET, EXPIRES - 1)).toEqual({
      ok: true,
    });
  });

  it('leaves a manifest with no object URLs unchanged', () => {
    const plain = '#EXTM3U\n#EXT-X-ENDLIST\n';
    expect(signManifestObjectUrls(plain, EXPIRES, SECRET)).toBe(plain);
  });

  it('does not double-sign an already signed URL', () => {
    const once = signManifestObjectUrls(master, EXPIRES, SECRET);
    const twice = signManifestObjectUrls(once, EXPIRES, SECRET);
    expect(twice).toBe(once);
  });
});
