import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as ResetLinks from '../db/reset-links.js';
import type * as InviteQueries from '../db/queries/invites.js';
import type * as LinkToken from '../api/auth/link-token.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('reset links from the command line (postgres)', () => {
  let tdb: TestDatabase;
  let resetLinks: typeof ResetLinks;
  let invites: typeof InviteQueries;
  let linkToken: typeof LinkToken;
  let database: typeof Database;

  beforeAll(async () => {
    process.env.PUBLIC_URL = 'https://video.example.com';
    tdb = await createTestDatabase();
    resetLinks = await import('../db/reset-links.js');
    invites = await import('../db/queries/invites.js');
    linkToken = await import('../api/auth/link-token.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  async function passwordAccount(email: string, removed = false) {
    const [user] = await tdb.sql`
      insert into users (display_name, role, disabled_at)
      values ('Ada', 'admin', ${removed ? new Date() : null}) returning id`;
    await tdb.sql`
      insert into password_credentials (user_id, email, password_hash)
      values (${user.id}, ${email}, 'scrypt$x')`;
    return user.id as string;
  }

  it('makes a week-long reset link with no creator for the account with the email', async () => {
    const userId = await passwordAccount('ada@example.com');
    const outcome = await resetLinks.resetLinkForEmail('  ADA@example.com ');
    expect(outcome).toMatchObject({ status: 'created', name: 'Ada' });
    const { url, expiresAt } = outcome as { url: string; expiresAt: Date };
    expect(url).toMatch(/^https:\/\/video\.example\.com\/studio\/reset\/[\w-]{43}$/);
    expect(Math.abs(expiresAt.getTime() - (Date.now() + 7 * 24 * 3600_000))).toBeLessThan(10_000);

    const link = await invites.findLink(linkToken.hashLinkToken(url.split('/').pop()!));
    expect(link).toMatchObject({ kind: 'reset', userId, email: 'ada@example.com' });
    const [row] = await tdb.sql`select created_by from invites`;
    expect(row.created_by).toBeNull();
  });

  it('says so for an unknown email or a removed account, making no link', async () => {
    await passwordAccount('gone@example.com', true);
    expect(await resetLinks.resetLinkForEmail('nobody@example.com')).toEqual({
      status: 'unknown_email',
    });
    expect(await resetLinks.resetLinkForEmail('gone@example.com')).toEqual({
      status: 'removed',
      name: 'Ada',
    });
    const [{ n }] = await tdb.sql`select count(*)::int as n from invites`;
    expect(n).toBe(0);
  });
});
