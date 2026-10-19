import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { loadDotenv } from './dotenv.js';
import { parseCidrList } from '../webhooks/egress.js';
import { parseOperatorUsers } from '../api/auth/operator-list.js';
import { DEFAULT_MAX_RENDITION, RENDITION_NAMES } from '../transcode/ffmpeg-args.js';

loadDotenv();

/**
 * The fixed secret older versions fell back to when SESSION_SECRET was unset.
 * It is public, so production refuses it for anyone who copied it into .env.
 */
const PUBLIC_DEV_SESSION_SECRET = 'dev-only-do-not-use-in-production-change-me';

/** A generated key, as POST /keys and db:seed-key print them. */
const BOOTSTRAP_KEY_FORMAT = /^sluby_[A-Za-z0-9_-]{32,}$/;

/** A flag. Anything but these is refused, so `TRUE` or `yes` never silently mean false. */
const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  /** production arms the startup guards below and switches logs to json.
   *  Nothing else depends on it: error stacks have their own setting. */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** pino level for the backend and the sia sdk's own messages. */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Adds the internal message and stack trace to error responses. For
   *  debugging only: they carry file paths and internals. */
  EXPOSE_ERROR_STACKS: flag('false'),

  /** PostgreSQL connection string */
  DATABASE_URL: z.url().default('postgresql://sluby:sluby@localhost:5432/sluby'),

  /** Redis connection string for BullMQ and caching */
  REDIS_URL: z.url().default('redis://localhost:6379'),

  /** Base URL of the indexd application API (no trailing slash).
   *  e.g. `http://127.0.0.1:9982` or `http://sia-indexd:9982` inside
   *  a Docker network. The SDK signs every request with the AppKey,
   *  so this URL doesn't need authentication of its own. */
  SIA_INDEXER_URL: z.url().default('https://sia.storage'),

  /** Base URL of the indexd admin API (no trailing slash). Used for
   *  out-of-band reads (wallet address, contract list) that the SDK
   *  doesn't expose. Must be HTTP-Basic-protected. */
  SIA_ADMIN_URL: z.url().default('http://127.0.0.1:9980'),

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
  SIA_NETWORK: z.enum(['zen', 'mainnet', 'testnet', 'anagami']).default('mainnet'),

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
  RECONCILE_ENABLED: flag('true'),

  /** How often the reconciliation worker compares the DB against the
   *  indexer inventory, in milliseconds. Defaults to hourly. */
  RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1000),

  /** Page size when reading the indexer's object change feed during
   *  reconciliation. The indexer answers 400 to more than 500, which would
   *  fail every run. */
  RECONCILE_PAGE_SIZE: z.coerce.number().int().positive().max(500).default(500),

  /** Whether the deletion garbage-collector sweep runs. It re-drives assets
   *  that were soft-deleted but whose objects were never fully unpinned (e.g.
   *  the worker crashed mid-way). */
  DELETION_GC_ENABLED: flag('true'),

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

  /** Optional bootstrap API key (raw sluby_ value). Seeded with every scope
   *  before the server listens, once: after it is deleted or rotated away it is
   *  never seeded again (see db/api-key-seeding.ts). It belongs to the
   *  workspace with no creator, so it acts as an admin. Production requires
   *  the format of a generated key. */
  BOOTSTRAP_API_KEY: z.string().optional(),

  /** Public base URL the browser sees (no trailing slash).
   *  Used to construct OAuth callback URLs and post-login redirects. */
  PUBLIC_URL: z.url().default('http://localhost:3000'),

  /** GitHub OAuth app client id (from https://github.com/settings/developers). */
  GITHUB_CLIENT_ID: z.string().optional(),

  /** GitHub OAuth app client secret. */
  GITHUB_CLIENT_SECRET: z.string().optional(),

  /** Who could sign in with GitHub before membership, comma-separated:
   *  logins (case-insensitive, each pinned to the account that first signed in
   *  with it), `id:<numeric github id>` entries, or `*`. It no longer decides
   *  who signs in: the first start after the upgrade removes the github
   *  accounts it refused (api/auth/adopt-legacy.ts), and later starts ignore
   *  it with a warning. */
  GITHUB_ALLOWED_USERS: z.string().default(''),

  /** Accounts that saw deployment-wide operations data before roles.
   *  Comma-separated `<provider>:<entry>`, the entry written as in that
   *  provider's allowlist: `github:id:583231`, `github:octocat`, `github:*`.
   *  It no longer makes anyone an admin: the first start after the upgrade
   *  makes the accounts it lists admins (api/auth/adopt-legacy.ts), and later
   *  starts ignore it with a warning. */
  OPERATOR_USERS: z
    .string()
    .default('')
    .superRefine((v, ctx) => {
      try {
        parseOperatorUsers(v);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
      }
    }),

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
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
      }
    }),

  /** HMAC secret for session cookies and signed object urls. Unset outside
   *  production, a random one is made for each run (see resolveEnv);
   *  production refuses to start without a strong one. */
  SESSION_SECRET: z.string().optional(),

  /** When set to 'true', turns sign-in off: every request acts as one local
   *  admin account (dev only). */
  AUTH_DISABLED: flag('false'),

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
            code: 'custom',
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

  /** How many usable API keys the workspace may hold. */
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

type ParsedEnv = z.infer<typeof envSchema>;
export type Env = Omit<ParsedEnv, 'SESSION_SECRET'> & { SESSION_SECRET: string };

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

/**
 * Why this configuration must not run in production, or an empty list.
 * Outside production nothing is refused, so the quickstart keeps working.
 */
export function checkProductionSafety(config: ParsedEnv): string[] {
  if (config.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  // session cookies map to a full upload, read and manage identity, so a
  // missing or guessable secret makes them forgeable
  const secret = config.SESSION_SECRET?.trim() ?? '';
  if (secret === '') {
    problems.push(
      'SESSION_SECRET is not set. Set a strong one (openssl rand -base64 32), so sessions ' +
        'survive restarts and cannot be forged.',
    );
  } else if (secret === PUBLIC_DEV_SESSION_SECRET) {
    problems.push('SESSION_SECRET is the old development default, which is public.');
  } else if (secret.length < 32) {
    problems.push(`SESSION_SECRET is only ${secret.length} characters (minimum 32).`);
  }

  if (config.AUTH_DISABLED) {
    problems.push('AUTH_DISABLED=true gives every visitor full access.');
  }

  if (
    config.BOOTSTRAP_API_KEY !== undefined &&
    !BOOTSTRAP_KEY_FORMAT.test(config.BOOTSTRAP_API_KEY)
  ) {
    problems.push(
      'BOOTSTRAP_API_KEY is not a generated key (sluby_ and at least 32 more letters, digits, ' +
        "- or _). Generate one: node -e \"console.log('sluby_' + require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }
  return problems;
}

export type EnvResult =
  { ok: true; env: Env; sessionSecretGenerated: boolean } | { ok: false; problems: string[] };

/**
 * Parse and check a set of variables: schema errors first, then the
 * production guards. An unset SESSION_SECRET outside production becomes a
 * random one for this run, so no public secret ever signs anything.
 */
export function resolveEnv(source: NodeJS.ProcessEnv): EnvResult {
  const result = envSchema.safeParse(withoutEmpty(source));
  if (!result.success) {
    const problems: string[] = [];
    for (const issue of result.error.issues) {
      problems.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { ok: false, problems };
  }
  const problems = checkProductionSafety(result.data);
  if (problems.length > 0) return { ok: false, problems };

  const sessionSecretGenerated = result.data.SESSION_SECRET === undefined;
  return {
    ok: true,
    sessionSecretGenerated,
    env: {
      ...result.data,
      SESSION_SECRET: result.data.SESSION_SECRET ?? randomBytes(32).toString('base64url'),
    },
  };
}

function loadEnv(): { env: Env; sessionSecretGenerated: boolean } {
  const result = resolveEnv(process.env);
  if (!result.ok) {
    // the logger is configured from this module, so plain stderr here
    console.error('Refusing to start, the configuration is not valid:');
    console.error(result.problems.map((p) => `  ${p}`).join('\n'));
    process.exit(1);
  }
  return result;
}

const loaded = loadEnv();
export const env: Env = loaded.env;
/** SESSION_SECRET was unset and this run uses a random one. */
export const sessionSecretGenerated = loaded.sessionSecretGenerated;
