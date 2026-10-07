// shared by connect-indexer.mjs and provision-viewer.mjs: register a new app
// with a sia indexer through its approval flow and return the app's identity.

import crypto from 'node:crypto';
import siaPkg from '@siafoundation/sia-storage';

const { initSia, Builder, generateRecoveryPhrase } = siaPkg;

const READY_POLL_MS = 5000;

/**
 * The indexer url for a connect script: the first argument, else
 * SIA_INDEXER_URL, else the hosted https://sia.storage. The argument wins
 * because compose always sets the variable inside the container. Prints
 * `usage` and exits for --help, and exits 2 on anything that is not an http
 * or https url.
 */
export function indexerUrlFromArgs(usage, argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
  if (argv.length > 1) {
    console.error(`expected at most one argument, the indexer url\n\n${usage}`);
    process.exit(2);
  }
  const value = argv[0] || env.SIA_INDEXER_URL || 'https://sia.storage';
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    console.error(`"${value}" is not an http or https url\n\n${usage}`);
    process.exit(2);
  }
  // the sdk wants the base url without a trailing slash
  return value.replace(/\/+$/, '');
}

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
