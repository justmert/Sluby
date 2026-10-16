import { describe, it, expect } from 'vitest';
import { envSchema, checkProductionSafety, resolveEnv } from '../config/env.js';

// the real schema and guards from config/env.ts; loadEnv only adds the exit
const STRONG_SECRET = 'a-session-secret-that-is-long-enough-to-pass';
const GENERATED_KEY = `sluby_${'A'.repeat(43)}`;

const parse = (source: Record<string, string>) => envSchema.parse(source);

describe('env schema', () => {
  it('defaults to what the compose stack uses', () => {
    const env = parse({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.EXPOSE_ERROR_STACKS).toBe(false);
    expect(env.SIA_INDEXER_URL).toBe('https://sia.storage');
    expect(env.SIA_NETWORK).toBe('mainnet');
    expect(env.PORT).toBe(3000);
    expect(env.RECONCILE_PAGE_SIZE).toBe(500);
    expect(env.AUTH_DISABLED).toBe(false);
    expect(env.RECONCILE_ENABLED).toBe(true);
    expect(env.DELETION_GC_ENABLED).toBe(true);
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('reads the flag value %s as %s', (value, expected) => {
    const env = parse({
      AUTH_DISABLED: value,
      RECONCILE_ENABLED: value,
      EXPOSE_ERROR_STACKS: value,
    });
    expect(env.AUTH_DISABLED).toBe(expected);
    expect(env.RECONCILE_ENABLED).toBe(expected);
    expect(env.EXPOSE_ERROR_STACKS).toBe(expected);
  });

  it.each(['TRUE', 'yes', 'on', 'False'])('refuses %j as a flag instead of reading false', (v) => {
    expect(envSchema.safeParse({ DELETION_GC_ENABLED: v }).success).toBe(false);
  });

  it('caps RECONCILE_PAGE_SIZE at the indexer limit of 500', () => {
    expect(parse({ RECONCILE_PAGE_SIZE: '200' }).RECONCILE_PAGE_SIZE).toBe(200);
    expect(envSchema.safeParse({ RECONCILE_PAGE_SIZE: '501' }).success).toBe(false);
  });

  it('accepts only known NODE_ENV and LOG_LEVEL values', () => {
    expect(parse({ NODE_ENV: 'production', LOG_LEVEL: 'warn' })).toMatchObject({
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    });
    expect(envSchema.safeParse({ NODE_ENV: 'staging' }).success).toBe(false);
    expect(envSchema.safeParse({ LOG_LEVEL: 'verbose' }).success).toBe(false);
  });

  it('coerces numbers and rejects bad ones', () => {
    expect(parse({ PORT: '8080', MAX_UPLOAD_SIZE: '5368709120' })).toMatchObject({
      PORT: 8080,
      MAX_UPLOAD_SIZE: 5368709120,
    });
    for (const PORT of ['-1', '0', 'abc', '3.5']) {
      expect(envSchema.safeParse({ PORT }).success).toBe(false);
    }
  });

  it('rejects urls that are not urls', () => {
    expect(envSchema.safeParse({ DATABASE_URL: 'not-a-url' }).success).toBe(false);
    expect(envSchema.safeParse({ PUBLIC_URL: 'not a url' }).success).toBe(false);
  });
});

describe('checkProductionSafety', () => {
  const prod = (extra: Record<string, string> = {}) =>
    parse({ NODE_ENV: 'production', SESSION_SECRET: STRONG_SECRET, ...extra });

  it('passes a sound production configuration', () => {
    expect(checkProductionSafety(prod())).toEqual([]);
    expect(checkProductionSafety(prod({ BOOTSTRAP_API_KEY: GENERATED_KEY }))).toEqual([]);
  });

  it('refuses a missing SESSION_SECRET', () => {
    const env = parse({ NODE_ENV: 'production' });
    expect(checkProductionSafety(env)).toEqual([
      expect.stringContaining('SESSION_SECRET is not set'),
    ]);
  });

  it('refuses the old public development secret', () => {
    const problems = checkProductionSafety(
      prod({ SESSION_SECRET: 'dev-only-do-not-use-in-production-change-me' }),
    );
    expect(problems).toEqual([expect.stringContaining('public')]);
  });

  it('refuses a short or blank SESSION_SECRET', () => {
    expect(checkProductionSafety(prod({ SESSION_SECRET: 'short' }))).toEqual([
      expect.stringContaining('only 5 characters'),
    ]);
    expect(checkProductionSafety(prod({ SESSION_SECRET: '   ' }))).toEqual([
      expect.stringContaining('not set'),
    ]);
  });

  it('refuses AUTH_DISABLED', () => {
    expect(checkProductionSafety(prod({ AUTH_DISABLED: 'true' }))).toEqual([
      expect.stringContaining('AUTH_DISABLED'),
    ]);
  });

  it.each([
    'changeme',
    'sluby_short',
    `${'x'.repeat(40)}`,
    `sluby_${'a'.repeat(31)}`,
    `sluby_${'a'.repeat(40)}!`,
  ])('refuses %s as a BOOTSTRAP_API_KEY', (key) => {
    expect(checkProductionSafety(prod({ BOOTSTRAP_API_KEY: key }))).toEqual([
      expect.stringContaining('BOOTSTRAP_API_KEY'),
    ]);
  });

  it('lists every problem at once', () => {
    const env = parse({ NODE_ENV: 'production', AUTH_DISABLED: 'true', BOOTSTRAP_API_KEY: 'x' });
    expect(checkProductionSafety(env)).toHaveLength(3);
  });

  it('refuses nothing outside production, so the quickstart runs', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const env = parse({ NODE_ENV, AUTH_DISABLED: 'true', BOOTSTRAP_API_KEY: 'changeme' });
      expect(checkProductionSafety(env)).toEqual([]);
    }
  });
});

describe('resolveEnv', () => {
  it('makes a random SESSION_SECRET for each run when none is set', () => {
    const a = resolveEnv({ NODE_ENV: 'development' });
    const b = resolveEnv({ NODE_ENV: 'development', SESSION_SECRET: '' });
    if (!a.ok || !b.ok) throw new Error('expected both to resolve');
    expect(a.sessionSecretGenerated).toBe(true);
    expect(b.sessionSecretGenerated).toBe(true);
    expect(a.env.SESSION_SECRET).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.env.SESSION_SECRET).not.toBe(b.env.SESSION_SECRET);
    expect(a.env.SESSION_SECRET).not.toBe('dev-only-do-not-use-in-production-change-me');
  });

  it('keeps a SESSION_SECRET that is set', () => {
    const r = resolveEnv({ SESSION_SECRET: STRONG_SECRET });
    if (!r.ok) throw new Error('expected to resolve');
    expect(r.sessionSecretGenerated).toBe(false);
    expect(r.env.SESSION_SECRET).toBe(STRONG_SECRET);
  });

  it('never makes one up in production', () => {
    const r = resolveEnv({ NODE_ENV: 'production' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]).toContain('SESSION_SECRET is not set');
  });

  it('reports schema errors by variable', () => {
    const r = resolveEnv({ PORT: 'abc', AUTH_DISABLED: 'yes' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.some((p) => p.startsWith('PORT:'))).toBe(true);
    expect(r.problems.some((p) => p.startsWith('AUTH_DISABLED:'))).toBe(true);
  });
});
