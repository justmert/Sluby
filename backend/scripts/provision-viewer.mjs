#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Provision a low-privilege "viewer" identity for direct-from-Sia playback.
//
// The web SDK has no anonymous mode, so the browser player needs its own
// registered Sia app key to construct an Sdk and download shared objects. This
// registers a SEPARATE identity from the uploader's: it can resolve shared
// objects but never touches the uploader's content or key, so it is safe to
// ship to browsers as a publishable key (like a Mux public key).
//
// Run once per deployment:
//   SIA_INDEXER_URL=https://sia.storage node scripts/provision-viewer.mjs
//   (or: npm run provision-viewer, or pass the indexer URL as the first arg)
//
// It prints a connect URL you approve in your indexer account, then prints the
// publishable browser config to put in the frontend env (VITE_SLUBY_SIA_*).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import siaPkg from 'sia-storage';

const { initSia, Builder, generateRecoveryPhrase } = siaPkg;

const indexerUrl = process.env.SIA_INDEXER_URL || process.argv[2] || 'https://sia.storage';
const READY_POLL_MS = 5000;
const READY_WAIT_MS = 60_000;

async function main() {
  console.log(`Provisioning a viewer identity against ${indexerUrl}\n`);
  await initSia();

  // A distinct 32-byte app id, so the viewer is its own app row, unrelated to
  // the uploader/backend app.
  const appId = crypto.randomBytes(32);
  const builder = new Builder(indexerUrl, {
    id: appId,
    name: 'Sluby Player',
    description: 'Low-privilege viewer for direct-from-Sia playback',
    serviceUrl: 'https://sluby.dev',
  });

  await builder.requestConnection();
  console.log('1. Open this URL while signed in to your indexer account and approve it:\n');
  console.log(`   ${builder.responseUrl()}\n`);
  console.log('2. Waiting for approval...');
  await builder.waitForApproval();

  const sdk = await builder.register(generateRecoveryPhrase());
  const appKeyHex = sdk.appKey().export().toString('hex');

  // A fresh account needs contracts to form before it can download. Poll
  // briefly so the output reflects real readiness, but do not block forever.
  const deadline = Date.now() + READY_WAIT_MS;
  let account = await sdk.account();
  while (!account.ready && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
    account = await sdk.account();
  }
  const ready = account.ready;

  console.log('\nViewer identity provisioned. Publishable browser config:\n');
  console.log(`   VITE_SLUBY_SIA_INDEXER_URL=${indexerUrl}`);
  console.log(`   VITE_SLUBY_SIA_APP_ID=${appId.toString('hex')}`);
  console.log(`   VITE_SLUBY_SIA_APP_KEY=${appKeyHex}\n`);

  if (ready) {
    console.log('Account is ready for downloads.');
  } else {
    console.log(
      'Account is not ready yet: contracts are still forming. Give it a few minutes; the ' +
        'account also needs a small balance to pay egress before playback works.',
    );
  }
}

main().catch((err) => {
  console.error('\nProvisioning failed:', err?.message ?? err);
  process.exit(1);
});
