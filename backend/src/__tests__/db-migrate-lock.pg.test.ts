import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { hasTestDatabase, TEST_DATABASE_URL } from './helpers/pg.js';

const backendDir = fileURLToPath(new URL('../..', import.meta.url));
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));

/** db:migrate as its own process, from another working directory, as replicas run it. */
function migrate(databaseUrl: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      tsx,
      [`${backendDir}src/db/migrate.ts`],
      { cwd: '/', env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' } },
      (err, stdout, stderr) =>
        resolve({
          code: err ? ((err as { code?: number }).code ?? 1) : 0,
          output: stdout + stderr,
        }),
    );
  });
}

// several backends starting at once on an empty database each run every
// migration; without the lock the second one fails on objects the first made
describe.skipIf(!hasTestDatabase)('db:migrate from replicas starting together (postgres)', () => {
  const name = `sluby_test_${randomBytes(6).toString('hex')}`;
  // built in the hook: a skipped describe still runs its body, and there is no url then
  let url: URL;

  beforeAll(async () => {
    url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${name}`);
    await admin.end();
  });

  afterAll(async () => {
    const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  it('applies every migration once while the others wait', async () => {
    const runs = await Promise.all([1, 2, 3].map(() => migrate(url.toString())));
    for (const run of runs) expect(run, run.output).toMatchObject({ code: 0 });

    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      const journal = (await import('../../drizzle/meta/_journal.json', { with: { type: 'json' } }))
        .default as { entries: unknown[] };
      expect(n).toBe(journal.entries.length);
    } finally {
      await sql.end();
    }
  }, 120_000);
});
