import { describe, it, expect } from 'vitest';
import { generatePlaybackId, isPlaybackId } from '../api/playback-id.js';

describe('playback id helpers', () => {
  describe('generatePlaybackId', () => {
    it('produces a pb_-prefixed, url-safe token', () => {
      const id = generatePlaybackId();
      expect(id).toMatch(/^pb_[A-Za-z0-9_-]{21}$/);
    });

    it('produces distinct ids across calls', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generatePlaybackId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('isPlaybackId', () => {
    it('recognises generated playback ids', () => {
      expect(isPlaybackId(generatePlaybackId())).toBe(true);
    });

    it('rejects a bare UUID (the internal asset id)', () => {
      expect(isPlaybackId('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(false);
    });

    it('rejects empty and non-prefixed strings', () => {
      expect(isPlaybackId('')).toBe(false);
      expect(isPlaybackId('asset-1')).toBe(false);
      expect(isPlaybackId('pbxyz')).toBe(false);
    });
  });
});
