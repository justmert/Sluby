import { describe, it, expect } from 'vitest';
import { envSchema, withoutEmpty } from '../config/env.js';

describe('env from docker compose', () => {
  // compose expands `${VAR:-}` for an unset variable to an empty string
  const composeEnv = {
    SIA_DATA_SHARDS: '',
    SIA_PARITY_SHARDS: '',
    SIA_ADMIN_URL: '',
    SIA_INDEXER_URL: 'https://sia.storage',
    PUBLIC_URL: 'http://localhost:8080',
  };

  it('treats empty values as unset so defaults apply', () => {
    const parsed = envSchema.safeParse(withoutEmpty(composeEnv));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.SIA_DATA_SHARDS).toBeUndefined();
    expect(parsed.data.SIA_PARITY_SHARDS).toBeUndefined();
    expect(parsed.data.SIA_ADMIN_URL).toBe('http://127.0.0.1:9980');
    expect(parsed.data.PUBLIC_URL).toBe('http://localhost:8080');
  });

  it('would reject the raw empty strings, which is the bug this guards', () => {
    expect(envSchema.safeParse(composeEnv).success).toBe(false);
  });

  it('accepts webhook networks as cidrs and refuses anything else at boot', () => {
    expect(
      envSchema.safeParse({ WEBHOOK_ALLOWED_NETWORKS: '10.0.5.0/24, fd00:5::/64' }).success,
    ).toBe(true);
    const bad = envSchema.safeParse({ WEBHOOK_ALLOWED_NETWORKS: '10.0.5.0/24,internal-hooks' });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error.issues[0].message).toContain('internal-hooks');
  });

  it('defaults the edge settings when compose passes them empty', () => {
    const parsed = envSchema.parse(
      withoutEmpty({
        ...composeEnv,
        CORS_ORIGIN: '',
        TRUST_PROXY: '',
        API_IP_RATE_LIMIT: '',
        METRICS_TOKEN: '',
      }),
    );
    expect(parsed.CORS_ORIGIN).toEqual([]);
    expect(parsed.TRUST_PROXY).toBe('loopback, linklocal, uniquelocal');
    expect(parsed.API_IP_RATE_LIMIT).toBe(600);
    expect(parsed.METRICS_TOKEN).toBeUndefined();
  });

  it('reads CORS_ORIGIN as a list of bare origins', () => {
    const parsed = envSchema.parse({
      CORS_ORIGIN: 'https://video.example.com, http://localhost:5173',
    });
    expect(parsed.CORS_ORIGIN).toEqual(['https://video.example.com', 'http://localhost:5173']);
  });

  it.each(['*', 'https://video.example.com/', 'video.example.com', 'https://x.example/studio'])(
    'refuses %s as a CORS_ORIGIN entry',
    (value) => {
      expect(envSchema.safeParse({ CORS_ORIGIN: value }).success).toBe(false);
    },
  );

  it('reads TRUST_PROXY as a hop count, a boolean or an address list', () => {
    expect(envSchema.parse({ TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(envSchema.parse({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(envSchema.parse({ TRUST_PROXY: '10.0.0.0/8' }).TRUST_PROXY).toBe('10.0.0.0/8');
  });

  it('keeps real values', () => {
    expect(withoutEmpty({ A: 'x', B: '', C: undefined })).toEqual({ A: 'x' });
  });
});

describe('TRANSCODE_MAX_RENDITION', () => {
  const parse = (value?: string) =>
    envSchema.safeParse(withoutEmpty({ TRANSCODE_MAX_RENDITION: value }));

  it('defaults to 1080p, also when compose passes it empty', () => {
    for (const value of [undefined, '']) {
      const parsed = parse(value);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.TRANSCODE_MAX_RENDITION).toBe('1080p');
    }
  });

  it('accepts every rung name', () => {
    for (const value of ['2160p', '1440p', '1080p', '720p', '540p', '360p']) {
      const parsed = parse(value);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.TRANSCODE_MAX_RENDITION).toBe(value);
    }
  });

  it('rejects anything else', () => {
    for (const value of ['4k', '2160', '480p', '2160P']) {
      expect(parse(value).success).toBe(false);
    }
  });
});
