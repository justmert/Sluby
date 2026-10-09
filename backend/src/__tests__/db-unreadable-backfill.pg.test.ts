import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { UNREADABLE_SOURCE_TEXTS } from '../transcode/source-errors.js';

const MIGRATION = new URL(
  '../../drizzle/0021_backfill_unreadable_not_retryable.sql',
  import.meta.url,
);

describe('migration 0021 matches the pipeline classifier', () => {
  it('looks for exactly the texts the pipeline treats as unreadable', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const texts = [...sql.matchAll(/strpos\("error_message", '([^']+)'\)/g)].map((m) => m[1]);
    expect(texts.sort()).toEqual([...UNREADABLE_SOURCE_TEXTS].sort());
  });
});

describe.skipIf(!hasTestDatabase)('migration 0021 on jobs from before B-15 (postgres)', () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    // stop before 0021, as a database upgraded from before it would be
    tdb = await createTestDatabase({ through: '0020_asset_plays' });
  }, 60_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  it('marks old unreadable failures final and leaves every other job alone', async () => {
    const job = async (status: string, error: string | null) => {
      const [asset] = await tdb.sql`
        insert into video_assets (title, creator_address, status)
        values ('v', 'alice', ${status === 'failed' ? 'failed' : 'processing'}) returning id`;
      const [session] = await tdb.sql`
        insert into upload_sessions (video_asset_id, upload_url, file_path, file_size, status)
        values (${asset.id}, 'u', '/x', 1, 'completed') returning id`;
      const [row] = await tdb.sql`
        insert into processing_jobs (video_asset_id, upload_session_id, status, error_message)
        values (${asset.id}, ${session.id}, ${status}::job_status, ${error}) returning id`;
      return row.id as string;
    };
    const invalid = await job(
      'failed',
      'ffprobe exited with code 1: /app/uploads/bf58: Invalid data found when processing input',
    );
    const noVideo = await job('failed', 'No video stream found');
    const network = await job('failed', 'FFmpeg exited with code 1: connection reset');
    const noError = await job('failed', null);
    const retrying = await job('retrying', 'No video stream found');

    // rows as written before B-15: the column default made them all retryable
    const before = await tdb.sql`select id, retryable from processing_jobs`;
    expect(before.every((r) => r.retryable === true)).toBe(true);
    const [{ relfilenode: fileBefore }] =
      await tdb.sql`select relfilenode from pg_class where relname = 'processing_jobs'`;

    await tdb.migrateToLatest();

    const after = Object.fromEntries(
      (await tdb.sql`select id, retryable from processing_jobs`).map((r) => [r.id, r.retryable]),
    );
    expect(after).toEqual({
      [invalid]: false,
      [noVideo]: false,
      [network]: true,
      [noError]: true,
      // not failed: a job still running keeps its flag, the pipeline decides
      [retrying]: true,
    });
    // an update in place, not a rewrite of the table
    const [{ relfilenode: fileAfter }] =
      await tdb.sql`select relfilenode from pg_class where relname = 'processing_jobs'`;
    expect(fileAfter).toBe(fileBefore);
  });
});
