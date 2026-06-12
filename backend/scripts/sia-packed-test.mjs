// Minimal packed upload test to isolate the error.
import { initSia, connect, AppKey, fromHex } from 'sia-storage';

await initSia();
const appMeta = {
  id: Buffer.from(fromHex(process.env.SIA_APP_ID)),
  name: 'SiaStream',
  description: 'Video streaming platform on Sia',
  serviceUrl: process.env.SIASTREAM_SERVICE_URL ?? 'http://localhost:5173',
};
const appKey = new AppKey(fromHex(process.env.SIA_APP_KEY));
const sdk = await connect(process.env.SIA_INDEXER_URL, appMeta, appKey);

console.log('creating packed upload (3+3 shards to fit 6 contracts)...');
const packed = await sdk.uploadPacked({ dataShards: 3, parityShards: 9, maxInflight: 12 });
console.log(' remaining:', packed.remaining().toString());
console.log(' length   :', packed.length().toString());
console.log(' slabs    :', packed.slabs().toString());

console.log('\nadding a 1 KiB object as Uint8Array...');
const u8data = new Uint8Array(1024);
for (let i = 0; i < u8data.length; i++) u8data[i] = (i * 31 + 7) & 0xff;
let offset = 0;
const readFn = async () => {
  if (offset >= u8data.length) return new Uint8Array(0);
  const end = Math.min(offset + 64 * 1024, u8data.length);
  const chunk = new Uint8Array(end - offset);
  chunk.set(u8data.subarray(offset, end));
  offset = end;
  return chunk;
};
try {
  const added = await packed.add(readFn);
  console.log(' added bytes:', added);
} catch (e) {
  console.error(' add failed:', e.message, 'code=', e.code);
}

console.log('\nfinalizing...');
try {
  const objs = await packed.finalize();
  console.log(' got objects:', objs.length);
  for (const o of objs) console.log('  - id:', o.id(), 'size:', o.size().toString());
} catch (e) {
  console.error(' finalize failed:', e.message, 'code=', e.code);
}
