// shared by connect-indexer.mjs and provision-viewer.mjs: register a new app
// with a sia indexer through its approval flow and return the app's identity.

import crypto from 'node:crypto';
import siaPkg from '@siafoundation/sia-storage';

const { initSia, Builder, generateRecoveryPhrase } = siaPkg;

const READY_POLL_MS = 5000;

/**
 * Ask the indexer for a connection, wait until the account owner approves it
 * in the browser, then register a fresh app key. Waits up to `readyWaitMs` for
 * the account to report ready (a new account forms contracts first).
 */
export async function connectApp({ indexerUrl, name, description, readyWaitMs = 120_000 }) {
  await initSia();

  // a fresh 32-byte id makes this its own app row on the indexer
  const appId = crypto.randomBytes(32);
  const builder = new Builder(indexerUrl, {
    id: appId,
    name,
    description,
    serviceUrl: 'https://github.com/justmert/Sluby',
  });

  await builder.requestConnection();
  console.log('1. Open this URL while signed in to your indexer account and approve it:\n');
  console.log(`   ${builder.responseUrl()}\n`);
  console.log('2. Waiting for approval...');
  await builder.waitForApproval();

  const sdk = await builder.register(generateRecoveryPhrase());
  const appKeyHex = sdk.appKey().export().toString('hex');

  const deadline = Date.now() + readyWaitMs;
  let account = await sdk.account();
  while (!account.ready && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
    account = await sdk.account();
  }

  return { appIdHex: appId.toString('hex'), appKeyHex, ready: account.ready };
}
