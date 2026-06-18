import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

// Load .env file before parsing process.env.
// Search upward from this file to find .env at the monorepo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPaths = [
  resolve(__dirname, '../../../.env'),   // backend/src/config -> monorepo root
  resolve(__dirname, '../../.env'),       // backend/src -> monorepo root (if running from src)
  resolve(process.cwd(), '.env'),         // CWD
  resolve(process.cwd(), '../.env'),      // one level up from CWD
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
    break;
  }
}

const envSchema = z.object({
  /** PostgreSQL connection string */
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://siastream:siastream@localhost:5432/siastream'),

  /** Redis connection string for BullMQ and caching */
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  /** Sia indexer base URL */
  SIA_INDEXER_URL: z.string().url().default('https://sia.storage'),

  /** Sia App ID — 32-byte identifier, hex-encoded (64 chars). Generated
   *  once via `npm run sia:onboard` and persisted across restarts. */
  SIA_APP_ID: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'SIA_APP_ID must be 64 hex chars (32 bytes)'),

  /** Sia App Key — private key exported from Builder.register(), hex-encoded.
   *  Actual byte length is determined by the SDK (Ed25519 private key);
   *  we validate hex format here and let the AppKey constructor fail at
   *  startup if the bytes are malformed. */
  SIA_APP_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]+$/, 'SIA_APP_KEY must be a hex string')
    .refine((v) => v.length % 2 === 0, 'SIA_APP_KEY must have an even number of hex chars'),

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

  /** Optional bootstrap API key (raw wss_ value).
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
   *  Empty/unset means no one (locks the UI entirely). Case-insensitive. */
  GITHUB_ALLOWED_USERS: z.string().default(''),

  /** HMAC secret for signing session cookies. Must be set in production. */
  SESSION_SECRET: z
    .string()
    .default('dev-only-do-not-use-in-production-change-me'),

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
  return result.data;
}

export const env = loadEnv();
