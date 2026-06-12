// Verifies that the credentials in .env produce a working SDK session
// against the local indexd.
import { initSia, connect, AppKey, fromHex } from 'sia-storage';

// Same AppMeta the backend & onboard use.
const APP_NAME = 'SiaStream';
const APP_DESCRIPTION = 'Video streaming platform on Sia';
const APP_SERVICE_URL = process.env.SIASTREAM_SERVICE_URL ?? 'http://localhost:5173';

await initSia();

const appMeta = {
  id: Buffer.from(fromHex(process.env.SIA_APP_ID)),
  name: APP_NAME,
  description: APP_DESCRIPTION,
  serviceUrl: APP_SERVICE_URL,
};
const appKey = new AppKey(fromHex(process.env.SIA_APP_KEY));

console.log('Indexer :', process.env.SIA_INDEXER_URL);
console.log('App ID  :', process.env.SIA_APP_ID);
console.log('PubKey  :', appKey.publicKey());

const sdk = await connect(process.env.SIA_INDEXER_URL, appMeta, appKey);
if (!sdk) {
  console.error('connect() returned null — indexer does not recognize the App Key');
  process.exit(1);
}
console.log('connect() -> Sdk instance');

const account = await sdk.account();
console.log('account():', JSON.stringify({
  accountKey: account.accountKey,
  maxPinnedData: account.maxPinnedData.toString(),
  remainingStorage: account.remainingStorage.toString(),
  pinnedData: account.pinnedData.toString(),
  pinnedSize: account.pinnedSize.toString(),
  ready: account.ready,
  app: account.app,
}, null, 2));
