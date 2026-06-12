/**
 * Sia onboarding CLI — drives the one-time connection flow with the
 * indexer using the `sia-storage` SDK (sia-sdk-rs via NAPI).
 *
 * Flow:
 *   1. Generate (or reuse from .env) a 32-byte App ID.
 *   2. Build AppMeta and call `builder.requestConnection()`.
 *   3. Print the approval URL — user opens it in a browser signed in to
 *      the indexer, and approves (entering a connect key generated in the
 *      indexer's admin UI).
 *   4. `builder.waitForApproval()` polls until the user approves.
 *   5. Generate a fresh BIP-39 recovery phrase, display it, require user
 *      to confirm they saved it.
 *   6. `builder.register(phrase)` returns an authenticated SDK; export
 *      the App Key (hex) and persist it + the App ID into .env.
 *
 * Usage:  cd backend && npm run sia:onboard
 *   Override target indexer:  SIA_INDEXER_URL=http://localhost:9982 npm run sia:onboard
 */

import {
  initSia,
  Builder,
  generateRecoveryPhrase,
  toHex,
  setLogger,
} from 'sia-storage';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config as dotenvConfig } from 'dotenv';
import {
  APP_NAME,
  APP_DESCRIPTION,
  APP_SERVICE_URL,
  buildAppMeta,
} from '../src/storage/sia-app-meta.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '../../.env');

// Load .env as a base; an explicit shell-env var still wins.
dotenvConfig({ path: ENV_PATH, override: false });

const DEFAULT_INDEXER_URL =
  process.env.SIA_INDEXER_URL ?? 'https://sia.storage';

const rl = createInterface({ input: stdin, output: stdout });

// ── tiny ANSI helpers ────────────────────────────────────────
function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function cyan(s: string): string { return `\x1b[36m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function dim(s: string): string { return `\x1b[2m${s}\x1b[0m`; }

async function readEnv(): Promise<string> {
  try {
    await access(ENV_PATH, fsConstants.F_OK);
    return await readFile(ENV_PATH, 'utf8');
  } catch {
    return '';
  }
}

function upsertEnvVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  if (content.length > 0 && !content.endsWith('\n')) content += '\n';
  return content + line + '\n';
}

async function persistCredentials(appIdHex: string, appKeyHex: string): Promise<void> {
  let content = await readEnv();
  content = upsertEnvVar(content, 'SIA_APP_ID', appIdHex);
  content = upsertEnvVar(content, 'SIA_APP_KEY', appKeyHex);
  if (!/^SIA_INDEXER_URL=/m.test(content)) {
    content = upsertEnvVar(content, 'SIA_INDEXER_URL', DEFAULT_INDEXER_URL);
  }
  await writeFile(ENV_PATH, content, { mode: 0o600 });
}

async function main(): Promise<void> {
  console.log('');
  console.log(bold('━━━ SiaStream onboarding ━━━'));
  console.log('');
  console.log(`Indexer:     ${cyan(DEFAULT_INDEXER_URL)}`);
  console.log(`App name:    ${cyan(APP_NAME)}`);
  console.log(`Service URL: ${cyan(APP_SERVICE_URL)}`);
  console.log('');

  await initSia();
  if (process.env.SIA_DEBUG) {
    setLogger((msg) => console.log(dim(`[sdk] ${msg}`)), 'debug');
  }

  // ── App ID ─────────────────────────────────────────
  const envContent = await readEnv();
  const existingMatch = envContent.match(/^SIA_APP_ID=([a-fA-F0-9]{64})$/m);
  let appIdHex: string;
  if (existingMatch) {
    appIdHex = existingMatch[1];
    console.log(`Reusing App ID from .env: ${dim(appIdHex)}`);
  } else {
    appIdHex = randomBytes(32).toString('hex');
    console.log(`Generated new App ID: ${dim(appIdHex)}`);
  }
  console.log('');

  // ── Request connection ─────────────────────────────
  const appMeta = buildAppMeta(appIdHex);
  const builder = new Builder(DEFAULT_INDEXER_URL, appMeta);

  console.log('Requesting connection from indexer…');
  await builder.requestConnection();
  const approvalUrl = builder.responseUrl();

  console.log('');
  console.log(bold(yellow('━━━ ACTION REQUIRED ━━━')));
  console.log('');
  console.log('Open this URL in your browser and approve the app:');
  console.log('');
  console.log(bold(cyan(approvalUrl)));
  console.log('');
  console.log(dim('(If using local indexd, first create a Connect Key in the admin UI at http://localhost:9980 and paste it on the approval page.)'));
  console.log('');

  console.log('Waiting for approval…');
  await builder.waitForApproval();
  console.log(green('✓ Approved.'));
  console.log('');

  // ── Recovery phrase ─────────────────────────────────
  console.log(bold(yellow('━━━ RECOVERY PHRASE ━━━')));
  console.log('');
  console.log('A fresh 12-word BIP-39 recovery phrase is generated below.');
  console.log('This is your master key. ' + bold('Save it securely') + ' — we do not store it.');
  console.log('Losing both the phrase and the App Key means losing access to your uploads.');
  console.log('');
  const phrase = generateRecoveryPhrase();
  console.log(bold(cyan(phrase)));
  console.log('');

  const ack = await rl.question('Type "I saved it" to continue (anything else aborts): ');
  if (ack.trim().toLowerCase() !== 'i saved it') {
    console.log(yellow('Aborted. No credentials were written.'));
    rl.close();
    process.exit(1);
  }

  // ── Register ─────────────────────────────────────────
  console.log('');
  console.log('Registering app key with indexer…');
  const sdk = await builder.register(phrase);
  const appKey = sdk.appKey();
  const appKeyBytes = appKey.export();
  const appKeyHex = toHex(appKeyBytes);

  console.log(green('✓ Registered.'));
  console.log('');
  console.log(`Public key:     ${dim(appKey.publicKey())}`);
  console.log(`App Key length: ${dim(`${appKeyBytes.length} bytes`)}`);
  console.log('');

  // ── Persist ─────────────────────────────────────────
  await persistCredentials(appIdHex, appKeyHex);
  console.log(green(`✓ Wrote SIA_APP_ID and SIA_APP_KEY to ${ENV_PATH}`));
  console.log('');
  console.log(bold(green('Onboarding complete.')));
  console.log('Restart the backend to pick up the new credentials.');
  console.log('');

  rl.close();
}

main().catch((err) => {
  console.error('');
  console.error('\x1b[31mOnboarding failed:\x1b[0m', err?.message ?? err);
  const details: Record<string, unknown> = {};
  if (err instanceof Error) {
    for (const key of Object.getOwnPropertyNames(err)) {
      if (key === 'stack') continue;
      details[key] = (err as unknown as Record<string, unknown>)[key];
    }
    if (err.cause !== undefined) details.cause = err.cause;
  }
  if (Object.keys(details).length > 0) console.error('Error properties:', details);
  if (err?.stack) console.error(err.stack);
  rl.close();
  process.exit(1);
});
