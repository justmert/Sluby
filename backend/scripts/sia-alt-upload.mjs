// Try uploading via @siafoundation/sia (the other SDK), reusing the same App Key.
import { initSia, connect, AppKey, fromHex, PinnedObject } from '@siafoundation/sia';

await initSia();
const appKey = new AppKey(fromHex(process.env.SIA_APP_KEY));
const sdk = await connect(process.env.SIA_INDEXER_URL, appKey);
if (!sdk) { console.error('connect null'); process.exit(1); }
console.log('connected via @siafoundation/sia');

const data = Buffer.alloc(64 * 1024);
for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;

// SiaClient.upload uses default shards. Use uploadPacked to override.
console.log('uploadPacked with 3+9 shards (12 contracts available)...');
try {
  const packed = sdk.uploadPacked({ dataShards: 3, parityShards: 9, maxInflight: 12 });
  let added = 0;
  added += await packed.add(data);
  console.log(' added bytes:', added);
  const objs = await packed.finalize();
  console.log(' got objects:', objs.length);
  for (const obj of objs) {
    console.log('  id:', obj.id(), 'size:', obj.size());
    await sdk.pinObject(obj);
    console.log('  pinned ✓');
  }
} catch (e) {
  console.error('upload failed:', e.message, 'code=', e.code);
}
