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

  it('keeps real values', () => {
    expect(withoutEmpty({ A: 'x', B: '', C: undefined })).toEqual({ A: 'x' });
  });
});
