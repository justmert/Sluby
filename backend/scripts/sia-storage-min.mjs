// Smallest-possible test of sia-storage's add(readFn) callback.
import { initSia, connect, AppKey, fromHex } from 'sia-storage';

await initSia();
const appMeta = {
  id: Buffer.from(fromHex(process.env.SIA_APP_ID)),
  name: 'SiaStream',
  description: 'Video streaming platform on Sia',
  serviceUrl: process.env.SIASTREAM_SERVICE_URL ?? 'http://localhost:5173',
};
const sdk = await connect(process.env.SIA_INDEXER_URL, appMeta, new AppKey(fromHex(process.env.SIA_APP_KEY)));
console.log('connected');

const packed = await sdk.uploadPacked({ dataShards: 3, parityShards: 9, maxInflight: 12 });

// Approach 1: literal closure that returns SAME Buffer each call
const blob1 = Buffer.from('hello world');
let calls1 = 0;
const f1 = async () => {
  calls1++;
  return calls1 === 1 ? blob1 : Buffer.alloc(0);
};

console.log('--- approach 1: literal closure ---');
try {
  const r = await packed.add(f1);
  console.log(' added:', r);
  console.log(' calls:', calls1);
} catch (e) {
  console.error(' FAILED:', e.message);
}

console.log('--- finalize ---');
try {
  const objs = await packed.finalize();
  console.log(' got:', objs.length);
} catch (e) {
  console.error(' finalize FAILED:', e.message);
}
