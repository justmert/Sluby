// Expiry rules for sia:// share maps, shared by the authenticated
// /api/v1/playback/:id/share route and the public /v1/share/:id route.

// Share URLs are per-session capabilities. Default an hour, allow up to six so
// a long watch (with mid-stream ABR rendition switches) stays resolvable, but
// cap gated content shorter since a leaked URL bypasses the gateway.
export const DEFAULT_SHARE_EXPIRES_IN = 3600;
export const MIN_SHARE_EXPIRES_IN = 60;
export const MAX_SHARE_EXPIRES_IN = 21600;
export const MAX_GATED_SHARE_EXPIRES_IN = 3600;

// Expiries snap to this grid so every caller asking for roughly the same
// lifetime gets the same map. The public /v1/share route lets anyone pick
// expires_in, and minting costs one indexer call per object, so the cache key
// must not follow the caller's exact number: with the grid an asset has at
// most one map per five-minute slot inside its cap.
export const SHARE_EXPIRY_GRID_SEC = 300;

// a gridded expiry is kept only when it leaves at least this much lifetime;
// closer to the hard limit the limit itself is used
const MIN_GRIDDED_LIFETIME_SEC = 60;

/**
 * Clamp a requested `expires_in` query value to the tier's bounds and return
 * it with the hard limit (unix seconds) the minted urls must not outlive.
 * `signatureExpiresSec` is a signed request's own expiry, which also bounds
 * the shares so they never outlive the capability that unlocked them.
 */
export function shareExpiryBounds(
  requested: unknown,
  gated: boolean,
  nowSec: number,
  signatureExpiresSec?: number,
): { expiresIn: number; notAfterSec: number } {
  const wanted = parseInt(String(requested ?? ''), 10) || DEFAULT_SHARE_EXPIRES_IN;
  const cap = gated ? MAX_GATED_SHARE_EXPIRES_IN : MAX_SHARE_EXPIRES_IN;
  const expiresIn = Math.min(Math.max(wanted, MIN_SHARE_EXPIRES_IN), cap);
  let notAfterSec = nowSec + cap;
  if (signatureExpiresSec !== undefined) notAfterSec = Math.min(notAfterSec, signatureExpiresSec);
  return { expiresIn, notAfterSec };
}

/**
 * The absolute expiry (unix seconds) to mint at: `nowSec + expiresIn` rounded
 * up to the grid, but never past `notAfterSec` (the tier cap, or a signed
 * request's own expiry). When rounding down below `notAfterSec` would leave
 * almost no lifetime, `notAfterSec` is used as is.
 */
export function shareExpirySec(nowSec: number, expiresIn: number, notAfterSec: number): number {
  const grid = SHARE_EXPIRY_GRID_SEC;
  const up = Math.ceil((nowSec + expiresIn) / grid) * grid;
  if (up <= notAfterSec) return up;
  const down = Math.floor(notAfterSec / grid) * grid;
  if (down >= nowSec + MIN_GRIDDED_LIFETIME_SEC) return down;
  return notAfterSec;
}
