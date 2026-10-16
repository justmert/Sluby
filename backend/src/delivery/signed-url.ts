import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-signed, expiring object URLs.
 *
 * The delivery gateway is unauthenticated so that public HLS plays from a
 * plain <video>/hls.js client. Private assets therefore need a capability
 * embedded in the URL itself: a signature over the object id, an expiry and
 * the asset's signing generation, which the gateway verifies before serving
 * bytes.
 *
 * The signature covers the object id and the expiry, so it cannot be replayed
 * against another object or extended. It also covers the asset's signing
 * generation, which the server raises on a tier change and on a revoke: every
 * url signed under an older generation then stops verifying, without touching
 * any other asset or the session secret.
 *
 * The key is derived from SESSION_SECRET for this use alone, so a signature
 * can never be mistaken for a session cookie's and the other way round.
 */

export type SignatureFailure = 'missing' | 'expired' | 'invalid';

export type VerifyResult =
  | {
      ok: true;
      /** when the capability ends, which is what the children get signed until */
      expiresAtSec: number;
    }
  | { ok: false; reason: SignatureFailure };

/** What an asset's signatures are checked against. */
export interface SigningState {
  generation: number;
  /**
   * Unix seconds until which urls signed the old way (the session secret
   * over `objectId:expires`, before generations existed) still verify; null
   * when the asset has none.
   */
  legacyUntilSec: number | null;
}

export const MIN_SIGNED_URL_TTL_SEC = 60;
export const DEFAULT_SIGNED_URL_TTL_SEC = 3600;
// six hours covers a feature film with pauses; past that a player re-mints
export const MAX_SIGNED_URL_TTL_SEC = 21600;

let derived: { secret: string; key: Buffer } | null = null;

/** The url signing key derived from the session secret. */
function urlSigningKey(secret: string): Buffer {
  if (derived?.secret !== secret) {
    const key = Buffer.from(hkdfSync('sha256', secret, '', 'sluby object url signing v2', 32));
    derived = { secret, key };
  }
  return derived.key;
}

/** Deterministic HMAC-SHA256 over the object, expiry and generation, hex encoded. */
export function signObjectAccess(
  objectId: string,
  expiresAtSec: number,
  generation: number,
  secret: string,
): string {
  return createHmac('sha256', urlSigningKey(secret))
    .update(`v2:${objectId}:${expiresAtSec}:${generation}`)
    .digest('hex');
}

/** The signature of the version before generations, kept only to verify old urls. */
function legacySignature(objectId: string, expiresAtSec: number, secret: string): string {
  return createHmac('sha256', secret).update(`${objectId}:${expiresAtSec}`).digest('hex');
}

/** Query string (`expires=...&sig=...`) granting timed access to an object. */
export function buildSignedObjectQuery(
  objectId: string,
  expiresAtSec: number,
  generation: number,
  secret: string,
): string {
  const sig = signObjectAccess(objectId, expiresAtSec, generation, secret);
  return `expires=${expiresAtSec}&sig=${sig}`;
}

/**
 * Sign every `/v1/objects/{id}` URL embedded in an HLS manifest so a single
 * signed master link authorizes the whole object graph.
 *
 * A private asset's manifests reference their variant playlists and media
 * file by gateway URL, and the gateway requires a valid signature per private
 * object. Signing only the master would leave those child URLs unsigned and
 * playback would 403 right after the master loads. So when the gateway serves
 * a private manifest it runs this over the body, minting a per-object
 * signature for each child at the expiry the caller already proved. The child
 * is then either another manifest (signed the same way on its own request) or
 * a media object served by byte range, each independently verifiable.
 *
 * Idempotent: a URL that already carries a `sig=` is left as-is, so re-signing
 * an already-signed manifest is a no-op.
 */
export function signManifestObjectUrls(
  manifestText: string,
  expiresAtSec: number,
  generation: number,
  secret: string,
): string {
  // Match `/v1/objects/{id}` plus any existing query up to a quote or
  // whitespace. The object id is a single URL path segment (no slashes).
  return manifestText.replace(
    /\/v1\/objects\/([^"\s?/]+)(\?[^"\s]*)?/g,
    (_full, id: string, existingQuery: string | undefined) => {
      if (existingQuery && /(?:^|[?&])sig=/.test(existingQuery)) {
        // Already signed; leave it untouched.
        return `/v1/objects/${id}${existingQuery}`;
      }
      const sig = signObjectAccess(id, expiresAtSec, generation, secret);
      const suffix = existingQuery ?? '';
      const sep = existingQuery ? '&' : '?';
      return `/v1/objects/${id}${suffix}${sep}expires=${expiresAtSec}&sig=${sig}`;
    },
  );
}

function sameHex(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is simply invalid
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify a signed object request against the owning asset's signing state.
 * `nowSec` is injected so the check is deterministic in tests.
 *
 * A url whose expiry lies further out than the six-hour cap is refused even
 * with a good signature, so no url can outlive the cap whatever minted it. A
 * url signed the old way verifies only inside the asset's legacy window, and
 * the children of a manifest served through one are signed no further than
 * that window's end.
 */
export function verifyObjectAccess(
  objectId: string,
  expires: string | undefined,
  sig: string | undefined,
  state: SigningState,
  secret: string,
  nowSec: number,
): VerifyResult {
  if (!expires || !sig) return { ok: false, reason: 'missing' };
  if (!/^\d{1,12}$/.test(expires)) return { ok: false, reason: 'invalid' };
  const expiresAtSec = Number(expires);

  let effectiveExpiry: number;
  if (sameHex(sig, signObjectAccess(objectId, expiresAtSec, state.generation, secret))) {
    if (expiresAtSec > nowSec + MAX_SIGNED_URL_TTL_SEC) return { ok: false, reason: 'invalid' };
    effectiveExpiry = expiresAtSec;
  } else if (
    state.legacyUntilSec !== null &&
    sameHex(sig, legacySignature(objectId, expiresAtSec, secret))
  ) {
    if (nowSec > state.legacyUntilSec) return { ok: false, reason: 'expired' };
    effectiveExpiry = Math.min(expiresAtSec, state.legacyUntilSec);
  } else {
    return { ok: false, reason: 'invalid' };
  }

  // Only report expiry once the signature itself is known good, so the error
  // cannot be used to probe which object ids exist.
  if (nowSec > expiresAtSec) return { ok: false, reason: 'expired' };

  return { ok: true, expiresAtSec: effectiveExpiry };
}
