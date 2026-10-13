// the browser never talks to indexd directly; objects are served by the
// sluby gateway at /v1/objects/:id on the studio's own origin, which handles
// access control, content types, and range requests

/** Same-origin gateway URL for a Sia object. */
export function siaObjectUrl(objectId: string): string {
  const key = objectId.startsWith('/') ? objectId.slice(1) : objectId;
  return `/v1/objects/${key}`;
}
