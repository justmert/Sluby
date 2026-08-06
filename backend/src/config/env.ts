import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

// Load .env file before parsing process.env.
// Search upward from this file to find .env at the monorepo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPaths = [
  resolve(__dirname, '../../../.env'), // backend/src/config -> monorepo root
  resolve(__dirname, '../../.env'), // backend/src -> monorepo root (if running from src)
  resolve(process.cwd(), '.env'), // CWD
  resolve(process.cwd(), '../.env'), // one level up from CWD
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
    break;
  }
}

/**
 * Placeholder session secret used for local development only. Sessions
 * signed with it grant full `manage` scope, so booting production with this
 * value would let anyone forge an admin cookie. loadEnv() hard-fails on it.
 */
const DEV_SESSION_SECRET = 'dev-only-do-not-use-in-production-change-me';

const envSchema = z.object({
  /** PostgreSQL connection string */
  DATABASE_URL: z.string().url().default('postgresql://sluby:sluby@localhost:5432/sluby'),

  /** Redis connection string for BullMQ and caching */
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  /** Base URL of the indexd application API (no trailing slash).
   *  e.g. `http://127.0.0.1:9982` or `http://sia-indexd:9982` inside
   *  a Docker network. The SDK signs every request with the AppKey,
   *  so this URL doesn't need authentication of its own. */
  SIA_INDEXER_URL: z.string().url().default('http://127.0.0.1:9982'),

  /** Base URL of the indexd admin API (no trailing slash). Used for
   *  out-of-band reads (wallet address, contract list) that the SDK
   *  doesn't expose. Must be HTTP-Basic-protected. */
  SIA_ADMIN_URL: z.string().url().default('http://127.0.0.1:9980'),

  /** HTTP-Basic password for the indexd admin API. Set in the indexd
   *  config file (`adminAPI.password`) and mirrored here. */
  SIA_ADMIN_PASSWORD: z.string().default(''),

  /** 32-byte AppKey secret (hex) the backend uses to sign indexd
   *  requests. Produced once during onboarding (Builder.register
   *  returns an Sdk whose .appKey().export() gives the bytes); persist
   *  here so the backend re-attaches via Builder.connected at boot. */
  SIA_APP_KEY: z.string().default(''),

  /** 32-byte App ID (hex). Stable across restarts so indexd ties all
   *  uploads to the same registered application row. */
  SIA_APP_ID: z.string().default(''),

  /** Erasure-coding shards per slab. Adjust to fit the host pool of
   *  the network being used: 2-of-6 works for the Zen testnet's small
   *  pool; 10-of-30 is the typical mainnet ratio. */
  SIA_DATA_SHARDS: z.coerce.number().int().positive().default(2),
  SIA_PARITY_SHARDS: z.coerce.number().int().positive().default(4),

  /** Which Sia network the connected indexd runs against. Used for
   *  UI labelling only (badge on the asset detail page, etc). */
  SIA_NETWORK: z.enum(['zen', 'mainnet', 'testnet', 'anagami']).default('zen'),

  /** HTTP server port */
  PORT: z.coerce.number().int().positive().default(3000),

  /** HTTP server host */
  HOST: z.string().default('0.0.0.0'),

  /** Directory for TUS upload files */
  UPLOAD_DIR: z.string().default('./uploads'),

  /** Directory for transcoded output files */
  TRANSCODE_OUTPUT_DIR: z.string().default('./transcode-output'),

  /** Maximum upload file size in bytes (default 10 GB) */
  MAX_UPLOAD_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024 * 1024),

  /** Local disk cache directory for aggregator */
  CACHE_DIR: z.string().default('./cache'),

  /** Maximum disk cache size in megabytes */
  CACHE_MAX_SIZE_MB: z.coerce.number().int().positive().default(10240),

  /** API rate limit: max requests per minute per key */
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(100),

  /** Whether the background reconciliation worker runs on a schedule.
   *  Set to 'false' to disable the periodic sweep (on-demand runs via the
   *  API still work). */
  RECONCILE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  /** How often the reconciliation worker compares the DB against the
   *  indexer inventory, in milliseconds. Defaults to hourly. */
  RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1000),

  /** Page size when replaying the indexer's object change feed during
   *  reconciliation. */
  RECONCILE_PAGE_SIZE: z.coerce.number().int().positive().default(500),

  /** Optional bootstrap API key (raw sluby_ value).
   *  If set and no API keys exist in the DB, this key is auto-seeded on startup
   *  with full scopes (upload, read, manage). Solves the bootstrap problem. */
  BOOTSTRAP_API_KEY: z.string().optional(),

  /** Public base URL the browser sees (no trailing slash).
   *  Used to construct OAuth callback URLs and post-login redirects. */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),

  /** GitHub OAuth app client id (from https://github.com/settings/developers). */
  GITHUB_CLIENT_ID: z.string().optional(),

  /** GitHub OAuth app client secret. */
  GITHUB_CLIENT_SECRET: z.string().optional(),

  /** Comma-separated list of GitHub usernames allowed into the Studio.
   *  When empty, Studio sign-in is OPEN to any GitHub account (each signer
   *  gets their own isolated tenant); the server logs a warning at startup
   *  in that case. Set it to lock the Studio down. Case-insensitive. */
  GITHUB_ALLOWED_USERS: z.string().default(''),

  /** HMAC secret for signing session cookies. Must be set in production;
   *  loadEnv() refuses to boot with the dev default when NODE_ENV=production. */
  SESSION_SECRET: z.string().default(DEV_SESSION_SECRET),

  /** When set to 'true', bypasses the GitHub auth gate entirely (dev only). */
  AUTH_DISABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    const messages: string[] = [];
    for (const [key, value] of Object.entries(formatted)) {
      if (key === '_errors') continue;
      const errors = (value as { _errors?: string[] })?._errors;
      if (errors && errors.length > 0) {
        messages.push(`  ${key}: ${errors.join(', ')}`);
      }
    }
    console.error('Environment validation failed:');
    console.error(messages.join('\n'));
    process.exit(1);
  }

  // Refuse to run production auth on a weak or publicly-known secret. Session
  // cookies signed with it map to a full upload+read+manage identity, so a
  // guessable secret makes admin sessions trivially forgeable.
  //
  // The empty-string case matters in Docker: compose expands an unset
  // `${SESSION_SECRET}` to "", which is NOT undefined, so zod's .default()
  // never fires and the value would silently be the empty string.
  const sessionSecret = result.data.SESSION_SECRET;
  if (
    process.env.NODE_ENV === 'production' &&
    (sessionSecret === DEV_SESSION_SECRET || sessionSecret.trim().length < 32)
  ) {
    const why =
      sessionSecret === DEV_SESSION_SECRET
        ? 'it is still the development default'
        : sessionSecret.trim().length === 0
          ? 'it is empty (an unset ${SESSION_SECRET} expands to "" in docker compose)'
          : `it is only ${sessionSecret.trim().length} characters (minimum 32)`;
    console.error(
      `Refusing to start: SESSION_SECRET is unsafe because ${why}, while NODE_ENV=production.\n` +
        '  Set a strong SESSION_SECRET, e.g.\n' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
