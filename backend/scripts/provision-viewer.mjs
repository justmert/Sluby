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
//   node scripts/provision-viewer.mjs [indexer url]
//   (or: npm run provision-viewer; the url defaults to SIA_INDEXER_URL, then
//   https://sia.storage)
//
// It prints a connect URL you approve in your indexer account, then prints the
// publishable browser config to put in the frontend env (VITE_SLUBY_SIA_*).
// ---------------------------------------------------------------------------

import { connectApp, indexerUrlFromArgs } from './sia-connect.mjs';

const indexerUrl = indexerUrlFromArgs(
  'usage: node scripts/provision-viewer.mjs [indexer url]\n' +
    '  registers a separate viewer app and prints the VITE_SLUBY_SIA_* settings for the studio.\n' +
    '  the indexer defaults to SIA_INDEXER_URL, then https://sia.storage',
);

async function main() {
  console.log(`Provisioning a viewer identity against ${indexerUrl}\n`);
  const { appIdHex, appKeyHex, ready } = await connectApp({
    indexerUrl,
    name: 'Sluby Player',
    description: 'Low-privilege viewer for direct-from-Sia playback',
    readyWaitMs: 60_000,
  });

  console.log('\nViewer identity provisioned. Publishable browser config:\n');
  console.log(`   VITE_SLUBY_SIA_INDEXER_URL=${indexerUrl}`);
  console.log(`   VITE_SLUBY_SIA_APP_ID=${appIdHex}`);
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
