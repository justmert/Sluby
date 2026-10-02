import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// the query module imports the db client; nothing here touches it
vi.mock('../config/database.js', () => ({ db: {} }));

import { assetListQuery } from '../db/queries/assets.js';
import { encodeCursor } from '../api/pagination.js';

const dialect = new PgDialect();
const render = (fragment: ReturnType<typeof sql> | undefined) =>
  fragment ? dialect.sqlToQuery(fragment) : null;
const orderSql = (q: ReturnType<typeof assetListQuery>) =>
  dialect.sqlToQuery(sql.join(q.orderBy, sql`, `)).sql;

describe('assetListQuery', () => {
  it('searches title and description case-insensitively, escaping wildcards', () => {
    const q = assetListQuery({ search: ' 50%_off ' });
    const where = render(q.filterWhere)!;
    expect(where.sql).toContain('"video_assets"."title" ilike $1');
    expect(where.sql).toContain('"video_assets"."description" ilike $2');
    expect(where.params).toEqual(['%50\\%\\_off%', '%50\\%\\_off%']);
  });

  it('also matches an exact asset id when the search is a uuid', () => {
    const id = '0b7a3f5e-8f3c-4c2a-9d39-0e1f5a6b7c8d';
    const where = render(assetListQuery({ search: id }).filterWhere)!;
    expect(where.sql).toContain('"video_assets"."id" = $3');
    expect(where.params[2]).toBe(id);
  });

  it('applies status, tier and owner filters with soft-delete exclusion', () => {
    const where = render(
      assetListQuery({ status: 'ready', accessTier: 'private', creatorAddress: 'github:me' })
        .filterWhere,
    )!;
    expect(where.sql).toContain('"video_assets"."deleted_at" is null');
    expect(where.params).toEqual(['ready', 'private', 'github:me']);
  });

  it('orders by the chosen key with an id tie-breaker', () => {
    expect(orderSql(assetListQuery({ sort: 'title', order: 'asc' }))).toBe(
      'lower("video_assets"."title") asc, "video_assets"."id" asc',
    );
    expect(orderSql(assetListQuery({ sort: 'size', order: 'desc' }))).toBe(
      '"video_assets"."total_storage_bytes" desc, "video_assets"."id" desc',
    );
    expect(orderSql(assetListQuery({}))).toBe(
      `date_trunc('milliseconds', "video_assets"."created_at") desc, "video_assets"."id" desc`,
    );
  });

  it('uses the cursor keyset only for the default order', () => {
    const cursor = encodeCursor({
      createdAt: new Date('2026-10-01T00:00:00Z'),
      id: '0b7a3f5e-8f3c-4c2a-9d39-0e1f5a6b7c8d',
    });
    expect(assetListQuery({ cursor }).cursorKey).not.toBeNull();
    expect(assetListQuery({ cursor, sort: 'title', order: 'asc' }).cursorKey).toBeNull();
    expect(render(assetListQuery({ cursor }).dataWhere)!.sql).toContain('date_trunc');
  });
});
