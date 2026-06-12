// Full upload+pin+download roundtrip on Zen testnet.
import * as SiaA from '@siafoundation/sia';
import * as Storage from 'sia-storage';
import { createHash } from 'node:crypto';

await SiaA.initSia();
await Storage.initSia();

const APP = {
  id: Buffer.from(Storage.fromHex(process.env.SIA_APP_ID)),
  name: 'SiaStream',
  description: 'Video streaming platform on Sia',
  serviceUrl: process.env.SIASTREAM_SERVICE_URL ?? 'http://localhost:5173',
};

const siaASdk = await SiaA.connect(process.env.SIA_INDEXER_URL,
  new SiaA.AppKey(SiaA.fromHex(process.env.SIA_APP_KEY)));
const storageSdk = await Storage.connect(process.env.SIA_INDEXER_URL, APP,
  new Storage.AppKey(Storage.fromHex(process.env.SIA_APP_KEY)));
console.log('both SDKs connected');

// ── 1. Upload deterministic 256 KiB payload ─────────────────────────
const payload = Buffer.alloc(256 * 1024);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 53 + 11) & 0xff;
const payloadSha = createHash('sha256').update(payload).digest('hex');
console.log(`\nuploading ${payload.length} bytes, sha256=${payloadSha.slice(0,16)}...`);

const packed = siaASdk.uploadPacked({ dataShards: 3, parityShards: 9, maxInflight: 12 });
await packed.add(payload);
const [mObj] = await packed.finalize();
console.log('uploaded id:', mObj.id());

// ── 2. Bridge seal→open and pin via storage SDK ─────────────────────
const toBuf = (v) => Buffer.isBuffer(v) ? v : typeof v === 'string' ? Buffer.from(v, 'base64') : v instanceof Uint8Array ? Buffer.from(v) : Buffer.alloc(0);
const raw = JSON.parse(mObj.seal(new SiaA.AppKey(SiaA.fromHex(process.env.SIA_APP_KEY))));
const sealed = {
  id: raw.id,
  encryptedDataKey:     toBuf(raw.encryptedDataKey),
  encryptedMetadataKey: toBuf(raw.encryptedMetadataKey),
  encryptedMetadata:    toBuf(raw.encryptedMetadata),
  dataSignature:        toBuf(raw.dataSignature),
  metadataSignature:    toBuf(raw.metadataSignature),
  slabs: (raw.slabs ?? []).map((s) => ({
    encryptionKey: toBuf(s.encryptionKey),
    minShards: s.minShards, offset: s.offset, length: s.length,
    sectors: (s.sectors ?? []).map((sec) => ({ root: sec.root, hostKey: sec.hostKey })),
  })),
  createdAt: new Date(raw.createdAt),
  updatedAt: new Date(raw.updatedAt),
};
const sObj = Storage.PinnedObject.open(new Storage.AppKey(Storage.fromHex(process.env.SIA_APP_KEY)), sealed);
await storageSdk.pinObject(sObj);
console.log('pinned ✓');

// ── 3. Look it up fresh via storage SDK ─────────────────────────────
const fresh = await storageSdk.object(mObj.id());
console.log('lookup via storage SDK: id=', fresh.id(), 'size=', fresh.size());

// ── 4. Download via siaA SDK (its download path matches its upload) ──
console.log('\ndownloading via siaA SDK...');
const downloaded = await siaASdk.download(mObj, (p) => {
  if (p.bytesTotal > 0) process.stdout.write(`\r ${p.phase}: ${p.bytesComplete}/${p.bytesTotal}`);
});
process.stdout.write('\n');
const downloadedSha = createHash('sha256').update(downloaded).digest('hex');
console.log('downloaded', downloaded.length, 'bytes  sha256=', downloadedSha.slice(0,16));
if (downloadedSha === payloadSha) {
  console.log('\n✅ HASHES MATCH — full Sia round-trip works');
} else {
  console.log('\n❌ HASH MISMATCH');
}
