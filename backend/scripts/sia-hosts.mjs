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
if (!sdk) { console.error('connect null'); process.exit(1); }

const hosts = await sdk.hosts();
console.log('host count:', hosts.length);
const goodForUpload = hosts.filter((h) => h.goodForUpload);
console.log('goodForUpload:', goodForUpload.length);
for (const h of hosts.slice(0, 5)) {
  console.log(` - ${h.publicKey.slice(0, 24)}…  goodForUpload=${h.goodForUpload}  country=${h.countryCode || '??'}  addrs=${h.addresses.length}`);
}
