import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, paginateRows } from '../api/pagination.js';

// Asset ids are UUIDs (the keyset predicate casts the cursor id to ::uuid).
const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';
const UID_C = '33333333-3333-4333-8333-333333333333';

const row = (id: string, iso: string) => ({ id, createdAt: new Date(iso) });

describe('cursor pagination helpers', () => {
  describe('encodeCursor / decodeCursor round-trip', () => {
    it('encodes a row into an opaque token and decodes it back', () => {
      const createdAt = new Date('2026-03-14T12:00:00.000Z');
      const token = encodeCursor({ createdAt, id: UID_A });

      // Opaque: not obviously the raw id/date.
      expect(token).not.toContain(UID_A);
      expect(typeof token).toBe('string');

      const decoded = decodeCursor(token);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe(UID_A);
      expect(decoded!.createdAt.toISOString()).toBe('2026-03-14T12:00:00.000Z');
    });

    it('produces URL-safe tokens (no +, /, or = padding)', () => {
      const token = encodeCursor({
        createdAt: new Date('2026-03-14T12:00:00.000Z'),
        id: UID_A,
      });
      expect(token).not.toMatch(/[+/=]/);
    });
  });

  describe('decodeCursor error handling', () => {
    it('returns null for a non-base64 token', () => {
      expect(decodeCursor('!!!not-base64!!!')).toBeNull();
    });

    it('returns null for a base64 token that is not the expected shape', () => {
      const bogus = Buffer.from('{"foo":"bar"}').toString('base64url');
      expect(decodeCursor(bogus)).toBeNull();
    });

    it('returns null for a token with an invalid date', () => {
      const bad = Buffer.from(JSON.stringify({ c: 'not-a-date', i: UID_A })).toString('base64url');
      expect(decodeCursor(bad)).toBeNull();
    });

    it('returns null for a token whose id is not a UUID', () => {
      // A crafted cursor with a non-UUID id would otherwise reach Postgres and
      // raise 22P02; decodeCursor rejects it so it falls back to page one.
      const bad = Buffer.from(
        JSON.stringify({ c: '2026-03-14T12:00:00.000Z', i: 'not-a-uuid' }),
      ).toString('base64url');
      expect(decodeCursor(bad)).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(decodeCursor('')).toBeNull();
    });
  });

  describe('paginateRows', () => {
    it('returns all rows with no next cursor when the page is not full', () => {
      const rows = [row(UID_A, '2026-01-03T00:00:00Z'), row(UID_B, '2026-01-02T00:00:00Z')];
      const page = paginateRows(rows, 5);

      expect(page.data).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('detects more pages when given limit+1 rows and trims the sentinel', () => {
      // caller fetched limit+1 (3) to probe for a next page
      const rows = [
        row(UID_A, '2026-01-03T00:00:00Z'),
        row(UID_B, '2026-01-02T00:00:00Z'),
        row(UID_C, '2026-01-01T00:00:00Z'),
      ];
      const page = paginateRows(rows, 2);

      expect(page.data.map((r) => r.id)).toEqual([UID_A, UID_B]);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).not.toBeNull();
      // cursor points at the last returned row, not the sentinel
      expect(decodeCursor(page.nextCursor!)!.id).toBe(UID_B);
    });

    it('returns an empty page for no rows', () => {
      const page = paginateRows([], 10);
      expect(page.data).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });
});
