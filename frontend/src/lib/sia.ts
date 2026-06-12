// ---------------------------------------------------------------------------
// Sia renterd URL helpers
// ---------------------------------------------------------------------------

const SIA_RENTERD_URL =
  import.meta.env.VITE_SIA_RENTERD_URL ??
  'http://localhost:9980';

/** Build a full URL for a Sia renterd object by its key / path. */
export function siaObjectUrl(objectId: string): string {
  // Strip leading slash if present to avoid double-slash
  const key = objectId.startsWith('/') ? objectId.slice(1) : objectId;
  return `${SIA_RENTERD_URL}/api/worker/objects/${key}`;
}
