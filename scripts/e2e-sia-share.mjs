#!/usr/bin/env node
// ---------------------------------------------------------------------------
// End-to-end check for the direct-from-Sia data path (opt-in, env-gated).
//
// Proves the pieces the browser relies on, against a REAL running backend and
// a REAL indexer, without a browser:
//   1. the backend mints a per-object share map (GET /playback/:id/share),
//   2. a low-privilege VIEWER app key (not the uploader's) resolves those
//      share URLs and downloads the asset's objects straight from Sia,
//   3. so the backend serves only the small JSON share map, never the bytes.
//
// It does NOT exercise the browser SiaSession / SiaLoader themselves (those are
// the WASM build and are covered by unit tests + the quickstart build); see
// docs/direct-from-sia.md for the manual browser check.
//
// Skips cleanly (exit 0) unless every env var below is set:
//   SIA_E2E_BACKEND_URL     e.g. http://localhost:4500
//   SIA_E2E_API_KEY         a read-scoped Sluby API key that owns the asset
//   SIA_E2E_ASSET_ID        a ready asset's id (or pb_ playback id)
//   SIA_E2E_INDEXER_URL     e.g. https://sia.storage
//   SIA_E2E_VIEWER_APP_ID   viewer app id (hex), from provision-viewer
//   SIA_E2E_VIEWER_APP_KEY  viewer app key (hex), from provision-viewer
// ---------------------------------------------------------------------------

import siaPkg from 'sia-storage';

const { initSia, AppKey, Builder } = siaPkg;

const env = process.env;
const required = [
  'SIA_E2E_BACKEND_URL',
  'SIA_E2E_API_KEY',
  'SIA_E2E_ASSET_ID',
  'SIA_E2E_INDEXER_URL',
  'SIA_E2E_VIEWER_APP_ID',
  'SIA_E2E_VIEWER_APP_KEY',
];
const missing = required.filter((k) => !env[k]);
if (missing.length > 0) {
  console.log(`[skip] direct-from-Sia e2e: set ${missing.join(', ')} to run.`);
  process.exit(0);
}

const backendUrl = env.SIA_E2E_BACKEND_URL.replace(/\/+$/, '');

async function drain(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** All object ids referenced in a manifest, in order, deduped. */
function objectIdsIn(manifest) {
  const ids = [];
  const seen = new Set();
  const re = /\/v1\/objects\/([0-9a-fA-F]+)/g;
  let m;
  while ((m = re.exec(manifest)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  return ids;
}

/** First `length@offset` byte range in a variant playlist, if any. */
function firstByteRange(playlist) {
  const seg = playlist.match(/#EXT-X-BYTERANGE:(\d+)@(\d+)/);
  if (seg) return { length: Number(seg[1]), offset: Number(seg[2]) };
  const map = playlist.match(/#EXT-X-MAP:[^\n]*BYTERANGE="(\d+)@(\d+)"/);
  if (map) return { length: Number(map[1]), offset: Number(map[2]) };
  return null;
}

async function main() {
  // 1. The backend mints the share map (this is the only backend call in the
  //    playback path; the bytes never go through it).
  const res = await fetch(
    `${backendUrl}/api/v1/playback/${encodeURIComponent(env.SIA_E2E_ASSET_ID)}/share`,
    { headers: { Authorization: `Bearer ${env.SIA_E2E_API_KEY}` } },
  );
  if (!res.ok) throw new Error(`share endpoint ${res.status}: ${await res.text()}`);
  const { master_object_id: master, shares } = await res.json();
  if (!master || !shares?.[master]) throw new Error('share map missing the master object');
  console.log(`share map: ${Object.keys(shares).length} objects, master ${master.slice(0, 12)}…`);

  // 2. Connect as the VIEWER (node build: Buffer app id + key).
  await initSia();
  const builder = new Builder(env.SIA_E2E_INDEXER_URL, {
    id: Buffer.from(env.SIA_E2E_VIEWER_APP_ID, 'hex'),
    name: 'Sluby Player e2e',
    description: 'direct-from-Sia e2e check',
    serviceUrl: 'https://sluby.dev',
  });
  const sdk = await builder.connected(new AppKey(Buffer.from(env.SIA_E2E_VIEWER_APP_KEY, 'hex')));
  if (!sdk) throw new Error('viewer app key is not registered with the indexer');

  const resolveText = async (objectId) => {
    const shareUrl = shares[objectId];
    if (!shareUrl) throw new Error(`no share URL for ${objectId}`);
    const obj = await sdk.sharedObject(shareUrl);
    return new TextDecoder().decode(await drain(sdk.download(obj)));
  };

  // 3. Master -> a variant -> the variant's data object, byte-ranged.
  const masterText = await resolveText(master);
  if (!masterText.includes('#EXTM3U')) throw new Error('master is not an m3u8');
  const variantId = objectIdsIn(masterText).find((id) => id !== master);
  if (!variantId) throw new Error('no variant object in the master');

  const variantText = await resolveText(variantId);
  if (!variantText.includes('#EXTM3U')) throw new Error('variant is not an m3u8');
  const dataId = objectIdsIn(variantText).find((id) => id !== variantId);
  if (!dataId) throw new Error('no data object in the variant');

  const range = firstByteRange(variantText);
  const dataObj = await sdk.sharedObject(shares[dataId]);
  const bytes = await drain(
    range
      ? sdk.download(dataObj, { offset: BigInt(range.offset), length: BigInt(range.length) })
      : sdk.download(dataObj),
  );
  if (bytes.length === 0) throw new Error('data object download returned no bytes');
  if (range && bytes.length !== range.length) {
    throw new Error(`byte range mismatch: wanted ${range.length}, got ${bytes.length}`);
  }

  console.log(
    `PASS: viewer key downloaded master + variant + a ${bytes.length}-byte segment range ` +
      `directly from Sia. The backend only served the share-map JSON.`,
  );
}

main().catch((err) => {
  console.error('FAIL:', err?.message ?? err);
  process.exit(1);
});
