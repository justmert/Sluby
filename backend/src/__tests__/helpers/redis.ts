/**
 * Redis-backed test support. Point SLUBY_TEST_REDIS_URL at a server you do
 * not mind tests writing to (e.g. redis://localhost:56380). Each test file
 * uses its own key prefix and removes its keys afterwards, so the server can
 * be shared.
 *
 * Without the variable the suites skip with a notice (printed once by
 * global-setup.ts); under CI a missing value is an error, as with the
 * postgres tests.
 */
import { randomBytes } from 'node:crypto';
import type { ConnectionOptions } from 'bullmq';

export const TEST_REDIS_URL = process.env.SLUBY_TEST_REDIS_URL ?? '';
export const hasTestRedis = TEST_REDIS_URL !== '';

if (!hasTestRedis && process.env.CI) {
  throw new Error('SLUBY_TEST_REDIS_URL is not set, but CI must run the redis queue tests');
}

export function testRedisConnection(): ConnectionOptions {
  const url = new URL(TEST_REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    password: url.password || undefined,
    db: url.pathname ? parseInt(url.pathname.slice(1), 10) || 0 : 0,
  };
}

/** A key prefix no other run shares, so suites never see each other's jobs. */
export function testQueuePrefix(): string {
  return `sluby-test-${randomBytes(6).toString('hex')}`;
}
