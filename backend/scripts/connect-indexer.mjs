#!/usr/bin/env node
// register sluby's backend with a sia indexer and print the SIA_APP_ID and
// SIA_APP_KEY lines for .env. run once per deployment:
//
//   docker compose run --rm backend node scripts/connect-indexer.mjs
//   (or from source: npm run connect-indexer --workspace=backend)
//
// the indexer defaults to SIA_INDEXER_URL, then the first argument, then the
// hosted https://sia.storage. you approve the connection in your indexer
// account in the browser; no recovery phrase or password is ever asked for.

import { connectApp } from './sia-connect.mjs';

const indexerUrl = process.env.SIA_INDEXER_URL || process.argv[2] || 'https://sia.storage';

async function main() {
  if (process.env.SIA_APP_KEY) {
    console.log('SIA_APP_KEY is already set; connecting again registers a second app.\n');
  }
  console.log(`Connecting Sluby to the indexer at ${indexerUrl}\n`);
  const { appIdHex, appKeyHex, ready } = await connectApp({
    indexerUrl,
    name: 'Sluby',
    description: 'Self-hosted video platform storing on Sia',
  });

  console.log('\nConnected. Add these to .env:\n');
  console.log(`SIA_INDEXER_URL=${indexerUrl}`);
  console.log(`SIA_APP_ID=${appIdHex}`);
  console.log(`SIA_APP_KEY=${appKeyHex}\n`);
  console.log('Keep SIA_APP_KEY secret: it can read and delete everything this app stores.');
  if (!ready) {
    console.log(
      '\nThe account is not ready yet: it is still forming storage contracts. Uploads ' +
        'start working once the dashboard shows the indexer as operational.',
    );
  }
}

main().catch((err) => {
  console.error('\nConnecting failed:', err?.message ?? err);
  process.exit(1);
});
