import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, paginateRows } from '../api/pagination.js';

const row = (id: string, iso: string) => ({ id, createdAt: new Date(iso) });

describe('cursor pagination helpers', () => {
  describe('encodeCursor / decodeCursor round-trip', () => {
    it('encodes a row into an opaque token and decodes it back', () => {
      const createdAt = new Date('2026-03-14T12:00:00.000Z');
      const token = encodeCursor({ createdAt, id: 'asset-42' });

      // Opaque: not obviously the raw id/date.
      expect(token).not.toContain('asset-42');
      expect(typeof token).toBe('string');

      const decoded = decodeCursor(token);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe('asset-42');
      expect(decoded!.createdAt.toISOString()).toBe('2026-03-14T12:00:00.000Z');
    });

    it('produces URL-safe tokens (no +, /, or = padding)', () => {
      const token = encodeCursor({
        createdAt: new Date('2026-03-14T12:00:00.000Z'),
        id: 'a/b+c==weird',
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
      const bad = Buffer.from(JSON.stringify({ c: 'not-a-date', i: 'x' })).toString('base64url');
      expect(decodeCursor(bad)).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(decodeCursor('')).toBeNull();
    });
  });

  describe('paginateRows', () => {
    it('returns all rows with no next cursor when the page is not full', () => {
      const rows = [row('a', '2026-01-03T00:00:00Z'), row('b', '2026-01-02T00:00:00Z')];
      const page = paginateRows(rows, 5);

      expect(page.data).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('detects more pages when given limit+1 rows and trims the sentinel', () => {
      // caller fetched limit+1 (3) to probe for a next page
      const rows = [
        row('a', '2026-01-03T00:00:00Z'),
        row('b', '2026-01-02T00:00:00Z'),
        row('c', '2026-01-01T00:00:00Z'),
      ];
      const page = paginateRows(rows, 2);

      expect(page.data.map((r) => r.id)).toEqual(['a', 'b']);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).not.toBeNull();
      // cursor points at the last returned row, not the sentinel
      expect(decodeCursor(page.nextCursor!)!.id).toBe('b');
    });

    it('returns an empty page for no rows', () => {
      const page = paginateRows([], 10);
      expect(page.data).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });
});
