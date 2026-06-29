// ---------------------------------------------------------------------------
// Sia object URL helpers
// ---------------------------------------------------------------------------
//
// The frontend never talks to indexd directly — indexd is protected by
// signed-URL auth (AppKey-derived) and not exposed to browsers. Instead,
// it goes through the Sluby gateway, which exposes objects at
// `/v1/objects/:objectId`, handles auth / access control, adds CORS
// headers, sets the right Content-Type, and supports Range requests
// for HLS segments.

import { BASE_URL } from './api-client';

/** Build a full URL for a Sia object served through the Sluby gateway. */
export function siaObjectUrl(objectId: string): string {
  // Strip leading slash if present to avoid double-slash
  const key = objectId.startsWith('/') ? objectId.slice(1) : objectId;
  return `${BASE_URL}/v1/objects/${key}`;
}
