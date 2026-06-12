// Hybrid: upload via @siafoundation/sia (works), get object back, then
// re-fetch via sia-storage SDK to pin (signing matches indexd).
import * as SiaA from '@siafoundation/sia';
import * as Storage from 'sia-storage';

await SiaA.initSia();
await Storage.initSia();

const APP_NAME = 'SiaStream';
const APP_DESC = 'Video streaming platform on Sia';
const APP_URL = process.env.SIASTREAM_SERVICE_URL ?? 'http://localhost:5173';

const siaAKey = new SiaA.AppKey(SiaA.fromHex(process.env.SIA_APP_KEY));
const siaASdk = await SiaA.connect(process.env.SIA_INDEXER_URL, siaAKey);
if (!siaASdk) throw new Error('siaA connect null');
console.log('siaA connected');

const storageKey = new Storage.AppKey(Storage.fromHex(process.env.SIA_APP_KEY));
const storageSdk = await Storage.connect(process.env.SIA_INDEXER_URL, {
  id: Buffer.from(Storage.fromHex(process.env.SIA_APP_ID)),
  name: APP_NAME, description: APP_DESC, serviceUrl: APP_URL,
}, storageKey);
if (!storageSdk) throw new Error('storage connect null');
console.log('storage connected');

const data = Buffer.alloc(64 * 1024);
for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;

console.log('\n--- siaA upload (3+9) ---');
const packed = siaASdk.uploadPacked({ dataShards: 3, parityShards: 9, maxInflight: 12 });
await packed.add(data);
const [siaAObj] = await packed.finalize();
console.log('uploaded id:', siaAObj.id(), 'size:', siaAObj.size());

console.log('\n--- bridge: seal siaA obj → open as storage obj ---');
try {
  const sealedJson = siaAObj.seal(siaAKey);
  console.log('  sealed first 200 chars:', sealedJson.slice(0,200));
  const raw = typeof sealedJson === 'string' ? JSON.parse(sealedJson) : sealedJson;

  // sia-storage's SealedObject expects Node Buffers (not base64 strings) for byte fields.
  // Convert each base64-encoded byte field back to Buffer.
  const toBuf = (v) => {
    if (v == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(v)) return v;
    if (typeof v === 'string') return Buffer.from(v, 'base64');
    if (Array.isArray(v)) return Buffer.from(v);
    if (v instanceof Uint8Array) return Buffer.from(v);
    return Buffer.alloc(0);
  };

  const sealed = {
    id: raw.id,
    encryptedDataKey:     toBuf(raw.encryptedDataKey),
    encryptedMetadataKey: toBuf(raw.encryptedMetadataKey),
    encryptedMetadata:    toBuf(raw.encryptedMetadata),
    dataSignature:        toBuf(raw.dataSignature),
    metadataSignature:    toBuf(raw.metadataSignature),
    slabs: (raw.slabs ?? []).map((s) => ({
      encryptionKey: toBuf(s.encryptionKey),
      minShards: s.minShards,
      offset: s.offset,
      length: s.length,
      sectors: (s.sectors ?? []).map((sec) => ({
        root: sec.root,
        hostKey: sec.hostKey,
      })),
    })),
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };

  const storageObj = Storage.PinnedObject.open(storageKey, sealed);
  console.log('  storage view: id=', storageObj.id(), 'size=', storageObj.size());
  await storageSdk.pinObject(storageObj);
  console.log('PINNED via storage SDK ✓');
} catch (e) {
  console.error('bridge/pin failed:', e.message);
  if (e.cause) console.error('cause:', e.cause);
}
