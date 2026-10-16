import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { parseCidrList } from '../webhooks/egress.js';
import { DEFAULT_MAX_RENDITION, RENDITION_NAMES } from '../transcode/ffmpeg-args.js';

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

export const envSchema = z.object({
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

  /** Erasure-coding shards per slab. Leave BOTH unset for the SDK default of
   *  10 data + 20 parity shards (30 hosts per slab). Set both only to fit a
   *  smaller host pool such as the Zen testnet's; the SDK and indexd reject
   *  ratios whose recovery probability is under 99.99% or whose redundancy is
   *  outside 1.5x to 4x. */
  SIA_DATA_SHARDS: z.coerce.number().int().positive().optional(),
  SIA_PARITY_SHARDS: z.coerce.number().int().positive().optional(),

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

  /** Tallest rung of the transcode ladder. 1440p and 2160p add rungs above
   *  the default 1080p for sources that tall; a lower value drops rungs. */
  TRANSCODE_MAX_RENDITION: z.enum(RENDITION_NAMES).default(DEFAULT_MAX_RENDITION),

  /** Size bound of the gateway's in-memory object cache, in megabytes. It
   *  holds whole objects of up to 8 MB fetched without a Range header
   *  (manifests, playlists, thumbnails) and counts against the backend
   *  container's memory; larger objects are streamed and never held. */
  CACHE_MAX_SIZE_MB: z.coerce.number().int().positive().default(256),

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

  /** Page size when reading the indexer's object change feed during
   *  reconciliation; the indexer's maximum, 500, applies above it. */
  RECONCILE_PAGE_SIZE: z.coerce.number().int().positive().default(500),

  /** Whether the deletion garbage-collector sweep runs. It re-drives assets
   *  that were soft-deleted but whose objects were never fully unpinned (e.g.
   *  the worker crashed mid-way). */
  DELETION_GC_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  /** How often the deletion GC sweep runs, in milliseconds. Defaults to
   *  every 15 minutes. */
  DELETION_GC_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),

  /** How long an asset may sit soft-deleted before the GC re-enqueues its
   *  deletion, in milliseconds. Defaults to 10 minutes. */
  DELETION_STUCK_THRESHOLD_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),

  /** Optional bootstrap API key (raw sluby_ value). Seeded at startup with
   *  every scope whenever that exact key is not in the database: a deleted one
   *  comes back on the next start, a rotated one stays retired. It belongs to
   *  its own `platform` account, not to any Studio user. */
  BOOTSTRAP_API_KEY: z.string().optional(),

  /** Public base URL the browser sees (no trailing slash).
   *  Used to construct OAuth callback URLs and post-login redirects. */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),

  /** GitHub OAuth app client id (from https://github.com/settings/developers). */
  GITHUB_CLIENT_ID: z.string().optional(),

  /** GitHub OAuth app client secret. */
  GITHUB_CLIENT_SECRET: z.string().optional(),

  /** Who may sign in with GitHub, comma-separated: logins (case-insensitive,
   *  each pinned to the account that first signs in with it), `id:<numeric
   *  github id>` entries, or `*` for open sign-up. Empty also leaves sign-up
   *  open, with a warning at startup. See api/auth/allowlist.ts. */
  GITHUB_ALLOWED_USERS: z.string().default(''),

  /** Networks webhook receivers may be on although they are private or
   *  otherwise special (loopback, RFC 1918, link-local, unique local, CGNAT,
   *  ...), comma-separated CIDRs or addresses such as `10.0.5.0/24,fd00:5::/64`.
   *  Empty: webhooks only reach public addresses. */
  WEBHOOK_ALLOWED_NETWORKS: z
    .string()
    .default('')
    .superRefine((v, ctx) => {
      try {
        parseCidrList(v);
      } catch (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
      }
    }),

  /** HMAC secret for signing session cookies. Must be set in production;
   *  loadEnv() refuses to boot with the dev default when NODE_ENV=production. */
  SESSION_SECRET: z.string().default(DEV_SESSION_SECRET),

  /** When set to 'true', bypasses the GitHub auth gate entirely (dev only). */
  AUTH_DISABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  /** Comma-separated browser origins that may call the API with the session
   *  cookie (credentialed CORS). Every other origin may still call it with a
   *  bearer key, without cookies, unless AUTH_DISABLED is on, in which case
   *  unlisted origins get no CORS at all. */
  CORS_ORIGIN: z
    .string()
    .default('')
    .transform((value, ctx) => {
      const origins = value
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o !== '');
      for (const origin of origins) {
        if (!isOrigin(origin)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `"${origin}" is not an origin (scheme://host[:port], no path or trailing ` +
              'slash). Leave CORS_ORIGIN unset to let any origin call the API without cookies.',
          });
        }
      }
      return origins;
    }),

  /** Which proxy hops Express trusts for the client address in
   *  X-Forwarded-For: a hop count, true, or comma-separated addresses, CIDR
   *  ranges and the names loopback, linklocal and uniquelocal. The default
   *  trusts private networks, which covers nginx alone and Caddy in front of
   *  nginx in the shipped stacks. */
  TRUST_PROXY: z
    .string()
    .default('loopback, linklocal, uniquelocal')
    .transform((v): boolean | number | string => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (/^\d+$/.test(v)) return Number(v);
      return v;
    }),

  /** Requests per minute one client IP may make to /api/v1 without a valid
   *  key or session (sign-in routes, the spec, failed authentication). */
  API_IP_RATE_LIMIT: z.coerce.number().int().positive().default(600),

  /** The highest per-minute rate_limit an API key gets. Keys asking for more
   *  are refused at creation, and older ones are held to this at use. */
  API_KEY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10000),

  /** How many usable API keys one account may hold. */
  API_KEYS_PER_ACCOUNT_MAX: z.coerce.number().int().positive().default(100),

  /** When set, GET /metrics (Prometheus) needs `Authorization: Bearer <token>`.
   *  Unset, it answers anyone who reaches the backend port. */
  METRICS_TOKEN: z.string().optional(),
});

/** True for a bare origin such as https://example.com or http://localhost:8080. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

export type Env = z.infer<typeof envSchema>;

/**
 * Docker compose turns `${VAR:-}` for an unset variable into an empty string,
 * which is not the same as unset: an empty SIA_DATA_SHARDS would fail the
 * number check and an empty URL would fail the url check instead of taking the
 * default. Treat empty values as unset.
 */
export function withoutEmpty(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

function loadEnv(): Env {
  const result = envSchema.safeParse(withoutEmpty(process.env));
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

  // AUTH_DISABLED grants every request full manage scope with no key; it must
  // never be on in production. Mirror the SESSION_SECRET guard and refuse boot.
  if (process.env.NODE_ENV === 'production' && result.data.AUTH_DISABLED) {
    console.error('Refusing to start: AUTH_DISABLED=true while NODE_ENV=production.');
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
