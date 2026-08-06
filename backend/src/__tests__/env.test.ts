import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// We cannot easily test loadEnv() because it calls process.exit on failure
// and is evaluated at module load time. Instead, we recreate the schema
// and test validation logic directly.

// Reproduce the schema from config/env.ts
const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgresql://sluby:sluby@localhost:5432/sluby'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SIA_INDEXER_URL: z.string().url().default('https://sia.storage'),
  SIA_APP_ID: z.string().length(64),
  SIA_APP_KEY: z.string().length(64),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  UPLOAD_DIR: z.string().default('./uploads'),
  TRANSCODE_OUTPUT_DIR: z.string().default('./transcode-output'),
  MAX_UPLOAD_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024 * 1024),
  CACHE_DIR: z.string().default('./cache'),
  CACHE_MAX_SIZE_MB: z.coerce.number().int().positive().default(10240),
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(100),
});

describe('config/env schema validation', () => {
  const validEnv = {
    SIA_APP_ID: 'a'.repeat(64),
    SIA_APP_KEY: 'b'.repeat(64),
  };

  describe('valid configurations', () => {
    it('should pass with minimal required env vars and use defaults', () => {
      const result = envSchema.safeParse(validEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(3000);
        expect(result.data.HOST).toBe('0.0.0.0');
        expect(result.data.SIA_INDEXER_URL).toBe('https://sia.storage');
        expect(result.data.DATABASE_URL).toBe('postgresql://sluby:sluby@localhost:5432/sluby');
        expect(result.data.REDIS_URL).toBe('redis://localhost:6379');
        expect(result.data.UPLOAD_DIR).toBe('./uploads');
        expect(result.data.TRANSCODE_OUTPUT_DIR).toBe('./transcode-output');
        expect(result.data.MAX_UPLOAD_SIZE).toBe(10 * 1024 * 1024 * 1024);
        expect(result.data.CACHE_DIR).toBe('./cache');
        expect(result.data.CACHE_MAX_SIZE_MB).toBe(10240);
        expect(result.data.API_RATE_LIMIT_PER_MIN).toBe(100);
      }
    });

    it('should coerce PORT from string to number', () => {
      const result = envSchema.safeParse({ ...validEnv, PORT: '8080' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(8080);
      }
    });

    it('should coerce MAX_UPLOAD_SIZE from string to number', () => {
      const result = envSchema.safeParse({ ...validEnv, MAX_UPLOAD_SIZE: '5368709120' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.MAX_UPLOAD_SIZE).toBe(5368709120);
      }
    });

    it('should accept custom DATABASE_URL', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/mydb',
      });
      expect(result.success).toBe(true);
    });

    it('should accept custom SIA_INDEXER_URL', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        SIA_INDEXER_URL: 'https://indexd.example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SIA_INDEXER_URL).toBe('https://indexd.example.com');
      }
    });
  });

  describe('invalid configurations', () => {
    it('should fail when SIA_APP_ID is missing', () => {
      const result = envSchema.safeParse({
        SIA_APP_KEY: 'b'.repeat(64),
      });
      expect(result.success).toBe(false);
    });

    it('should fail when SIA_APP_KEY is missing', () => {
      const result = envSchema.safeParse({
        SIA_APP_ID: 'a'.repeat(64),
      });
      expect(result.success).toBe(false);
    });

    it('should fail when SIA_APP_ID is wrong length', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        SIA_APP_ID: 'tooshort',
      });
      expect(result.success).toBe(false);
    });

    it('should fail when SIA_APP_KEY is wrong length', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        SIA_APP_KEY: 'tooshort',
      });
      expect(result.success).toBe(false);
    });

    it('should fail when DATABASE_URL is not a valid URL', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        DATABASE_URL: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('should fail when REDIS_URL is not a valid URL', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        REDIS_URL: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('should fail when PORT is negative', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        PORT: '-1',
      });
      expect(result.success).toBe(false);
    });

    it('should fail when PORT is zero', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        PORT: '0',
      });
      expect(result.success).toBe(false);
    });

    it('should fail when CACHE_MAX_SIZE_MB is zero', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        CACHE_MAX_SIZE_MB: '0',
      });
      expect(result.success).toBe(false);
    });

    it('should fail when SIA_INDEXER_URL is not a valid URL', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        SIA_INDEXER_URL: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });
  });
});
