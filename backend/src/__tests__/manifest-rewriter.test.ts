import { describe, it, expect } from 'vitest';
import {
  rewriteVariantPlaylist,
  rewriteMasterPlaylist,
  parseVariantPlaylist,
  parseMasterPlaylist,
  type SegmentBlobMapping,
} from '../transcode/manifest-rewriter.js';

const BASE_URL = 'https://sia.storage';

describe('manifest-rewriter', () => {
  describe('parseVariantPlaylist', () => {
    it('should extract init segment and media segments from a variant playlist', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:6.000000,',
        'seg_0000.m4s',
        '#EXTINF:6.000000,',
        'seg_0001.m4s',
        '#EXTINF:4.500000,',
        'seg_0002.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);

      expect(result.initSegment).toBe('init.mp4');
      expect(result.segments).toEqual(['seg_0000.m4s', 'seg_0001.m4s', 'seg_0002.m4s']);
    });

    it('should return null for initSegment when none is present', () => {
      const content = [
        '#EXTM3U',
        '#EXTINF:6.000000,',
        'seg_0000.ts',
        '#EXTINF:6.000000,',
        'seg_0001.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);

      expect(result.initSegment).toBeNull();
      expect(result.segments).toEqual(['seg_0000.ts', 'seg_0001.ts']);
    });

    it('should handle empty content', () => {
      const result = parseVariantPlaylist('');
      expect(result.initSegment).toBeNull();
      expect(result.segments).toEqual([]);
    });

    it('should skip non-segment, non-comment lines', () => {
      const content = [
        '#EXTM3U',
        '#EXTINF:6.000000,',
        'seg_0000.m4s',
        'some-random-line.txt', // Not a recognized segment extension
        '#EXTINF:6.000000,',
        'seg_0001.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);
      expect(result.segments).toEqual(['seg_0000.m4s', 'seg_0001.m4s']);
    });

    it('should handle .ts segment files', () => {
      const content = [
        '#EXTM3U',
        '#EXTINF:6.000000,',
        'segment0.ts',
        '#EXTINF:6.000000,',
        'segment1.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);
      expect(result.segments).toEqual(['segment0.ts', 'segment1.ts']);
    });

    it('should handle .mp4 segment files', () => {
      const content = [
        '#EXTM3U',
        '#EXTINF:6.000000,',
        'chunk_0000.mp4',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);
      expect(result.segments).toEqual(['chunk_0000.mp4']);
    });

    it('should trim whitespace from lines', () => {
      const content = [
        '#EXTM3U',
        '  #EXT-X-MAP:URI="init.mp4"  ',
        '#EXTINF:6.000000,',
        '  seg_0000.m4s  ',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);
      expect(result.initSegment).toBe('init.mp4');
      expect(result.segments).toEqual(['seg_0000.m4s']);
    });
  });

  describe('parseMasterPlaylist', () => {
    it('should extract variant playlist paths', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
        '1080p/playlist.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720',
        '720p/playlist.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=960x540',
        '540p/playlist.m3u8',
      ].join('\n');

      const paths = parseMasterPlaylist(content);
      expect(paths).toEqual([
        '1080p/playlist.m3u8',
        '720p/playlist.m3u8',
        '540p/playlist.m3u8',
      ]);
    });

    it('should return empty array for empty content', () => {
      expect(parseMasterPlaylist('')).toEqual([]);
    });

    it('should skip non-m3u8 lines', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000',
        '1080p/playlist.m3u8',
        'some-random-line.txt',
      ].join('\n');

      const paths = parseMasterPlaylist(content);
      expect(paths).toEqual(['1080p/playlist.m3u8']);
    });

    it('should handle only comment lines', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '# comment line',
      ].join('\n');

      const paths = parseMasterPlaylist(content);
      expect(paths).toEqual([]);
    });
  });

  describe('rewriteVariantPlaylist', () => {
    it('should rewrite init segment and media segment URIs', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:6.000000,',
        'seg_0000.m4s',
        '#EXTINF:6.000000,',
        'seg_0001.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const mapping: SegmentBlobMapping = {
        initObjectId: 'init-blob-id-123',
        segments: new Map([
          ['seg_0000.m4s', 'blob-seg-0'],
          ['seg_0001.m4s', 'blob-seg-1'],
        ]),
      };

      const result = rewriteVariantPlaylist(content, mapping, BASE_URL);

      expect(result).toContain(`#EXT-X-MAP:URI="${BASE_URL}/v1/objects/init-blob-id-123"`);
      expect(result).toContain(`${BASE_URL}/v1/objects/blob-seg-0`);
      expect(result).toContain(`${BASE_URL}/v1/objects/blob-seg-1`);
      expect(result).not.toContain('seg_0000.m4s');
      expect(result).not.toContain('seg_0001.m4s');
      expect(result).not.toContain('init.mp4');
    });

    it('should preserve non-segment lines unchanged', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:6.000000,',
        'seg_0000.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const mapping: SegmentBlobMapping = {
        initObjectId: 'init-id',
        segments: new Map([['seg_0000.m4s', 'seg-id']]),
      };

      const result = rewriteVariantPlaylist(content, mapping, BASE_URL);

      expect(result).toContain('#EXTM3U');
      expect(result).toContain('#EXT-X-VERSION:7');
      expect(result).toContain('#EXT-X-TARGETDURATION:6');
      expect(result).toContain('#EXT-X-MEDIA-SEQUENCE:0');
      expect(result).toContain('#EXT-X-ENDLIST');
    });

    it('should not replace segment names that appear as substrings in other lines', () => {
      // seg_0000.m4s should only be replaced when it's on its own line
      const content = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="init.mp4"',
        '# Comment about seg_0000.m4s',
        '#EXTINF:6.000000,',
        'seg_0000.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const mapping: SegmentBlobMapping = {
        initObjectId: 'init-id',
        segments: new Map([['seg_0000.m4s', 'seg-id']]),
      };

      const result = rewriteVariantPlaylist(content, mapping, BASE_URL);

      // The comment line should be unchanged (the regex uses ^ and $ with 'm' flag)
      expect(result).toContain('# Comment about seg_0000.m4s');
    });

    it('should handle filenames with special regex characters', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:6.000000,',
        'seg_0000[1].m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const mapping: SegmentBlobMapping = {
        initObjectId: 'init-id',
        segments: new Map([['seg_0000[1].m4s', 'seg-special-id']]),
      };

      const result = rewriteVariantPlaylist(content, mapping, BASE_URL);
      expect(result).toContain(`${BASE_URL}/v1/objects/seg-special-id`);
    });
  });

  describe('rewriteMasterPlaylist', () => {
    it('should rewrite variant playlist paths to blob URLs', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
        '1080p/playlist.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720',
        '720p/playlist.m3u8',
      ].join('\n');

      const variantBlobMap = new Map([
        ['1080p/playlist.m3u8', 'blob-1080p'],
        ['720p/playlist.m3u8', 'blob-720p'],
      ]);

      const result = rewriteMasterPlaylist(content, variantBlobMap, BASE_URL);

      expect(result).toContain(`${BASE_URL}/v1/objects/blob-1080p`);
      expect(result).toContain(`${BASE_URL}/v1/objects/blob-720p`);
      expect(result).not.toContain('1080p/playlist.m3u8');
      expect(result).not.toContain('720p/playlist.m3u8');
    });

    it('should preserve STREAM-INF tags', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
        '1080p/playlist.m3u8',
      ].join('\n');

      const variantBlobMap = new Map([
        ['1080p/playlist.m3u8', 'blob-1080p'],
      ]);

      const result = rewriteMasterPlaylist(content, variantBlobMap, BASE_URL);
      expect(result).toContain('#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080');
    });

    it('should leave unmapped paths unchanged', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
        '1080p/playlist.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720',
        '720p/playlist.m3u8',
      ].join('\n');

      // Only map 1080p
      const variantBlobMap = new Map([
        ['1080p/playlist.m3u8', 'blob-1080p'],
      ]);

      const result = rewriteMasterPlaylist(content, variantBlobMap, BASE_URL);
      expect(result).toContain(`${BASE_URL}/v1/objects/blob-1080p`);
      expect(result).toContain('720p/playlist.m3u8');
    });
  });
});
