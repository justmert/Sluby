import { nanoid } from 'nanoid';

/**
 * Public playback identifiers. A playback id is a rotatable, public handle
 * (`pb_...`) that maps to an internal video asset. The `pb_` prefix also
 * lets the delivery gateway tell a playback id apart from a raw asset UUID
 * in a single path segment.
 */

const PLAYBACK_ID_PREFIX = 'pb_';
/** nanoid's default alphabet is url-safe: A-Za-z0-9_-. Default length 21. */
const PLAYBACK_ID_BODY = /^[A-Za-z0-9_-]{21}$/;

export function generatePlaybackId(): string {
  return `${PLAYBACK_ID_PREFIX}${nanoid()}`;
}

export function isPlaybackId(value: string): boolean {
  if (!value.startsWith(PLAYBACK_ID_PREFIX)) return false;
  return PLAYBACK_ID_BODY.test(value.slice(PLAYBACK_ID_PREFIX.length));
}
