import { describe, it, expect } from 'vitest';
import {
  rewriteVariantPlaylist,
  rewriteMasterPlaylist,
  parseVariantPlaylist,
  parseMasterPlaylist,
  parseMasterVariants,
  type SegmentBlobMapping,
} from '../transcode/manifest-rewriter.js';

const BASE_URL = 'https://sia.storage';

describe('manifest-rewriter (single_file byte-range mode)', () => {
  describe('parseVariantPlaylist', () => {
    it('extracts the data filename and segment count from a single_file playlist', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-MAP:URI="data.m4s",BYTERANGE="806@0"',
        '#EXTINF:6.000000,',
        '#EXT-X-BYTERANGE:157059@806',
        'data.m4s',
        '#EXTINF:6.000000,',
        '#EXT-X-BYTERANGE:160000@157865',
        'data.m4s',
        '#EXTINF:4.500000,',
        '#EXT-X-BYTERANGE:120000@317865',
        'data.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);

      expect(result.dataFilename).toBe('data.m4s');
      expect(result.segmentCount).toBe(3);
    });

    it('returns nulls / zero for empty content', () => {
      const result = parseVariantPlaylist('');
      expect(result.dataFilename).toBeNull();
      expect(result.segmentCount).toBe(0);
    });

    it('finds the data filename even if EXT-X-MAP is absent (falls back to bare lines)', () => {
      const content = [
        '#EXTM3U',
        '#EXTINF:6.000000,',
        '#EXT-X-BYTERANGE:1000@0',
        'video.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);
      expect(result.dataFilename).toBe('video.m4s');
      expect(result.segmentCount).toBe(1);
    });

    it('trims whitespace', () => {
      const content = [
        '#EXTM3U',
        '  #EXT-X-MAP:URI="data.m4s",BYTERANGE="806@0"  ',
        '#EXTINF:6.000000,',
        '#EXT-X-BYTERANGE:1000@806',
        '  data.m4s  ',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const result = parseVariantPlaylist(content);
      expect(result.dataFilename).toBe('data.m4s');
      expect(result.segmentCount).toBe(1);
    });
  });

  describe('parseMasterPlaylist', () => {
    it('extracts variant playlist paths', () => {
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
      expect(paths).toEqual(['1080p/playlist.m3u8', '720p/playlist.m3u8', '540p/playlist.m3u8']);
    });

    it('returns empty for empty input', () => {
      expect(parseMasterPlaylist('')).toEqual([]);
    });

    it('skips non-m3u8 lines', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000',
        '1080p/playlist.m3u8',
        'some-random-line.txt',
      ].join('\n');
      expect(parseMasterPlaylist(content)).toEqual(['1080p/playlist.m3u8']);
    });

    it('handles only comment lines', () => {
      const content = ['#EXTM3U', '#EXT-X-VERSION:7', '# comment line'].join('\n');
      expect(parseMasterPlaylist(content)).toEqual([]);
    });
  });

  describe('rewriteVariantPlaylist', () => {
    it('rewrites EXT-X-MAP URI and bare-filename lines to gateway URLs, preserves BYTERANGE attributes', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-MAP:URI="data.m4s",BYTERANGE="806@0"',
        '#EXTINF:6.000000,',
        '#EXT-X-BYTERANGE:157059@806',
        'data.m4s',
        '#EXTINF:6.000000,',
        '#EXT-X-BYTERANGE:160000@157865',
        'data.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const mapping: SegmentBlobMapping = {
        dataObjectId: 'sia-data-id-123',
        dataFilename: 'data.m4s',
      };

      const result = rewriteVariantPlaylist(content, mapping, BASE_URL);

      // EXT-X-MAP URI is rewritten; BYTERANGE attribute is preserved
      expect(result).toContain(`#EXT-X-MAP:URI="${BASE_URL}/v1/objects/sia-data-id-123"`);
      // BYTERANGE attr was on the original EXT-X-MAP line → still present
      expect(result).toContain('BYTERANGE="806@0"');
      // Bare filename lines now point at the gateway URL
      expect(result).toContain(`${BASE_URL}/v1/objects/sia-data-id-123`);
      // EXT-X-BYTERANGE for individual segments untouched
      expect(result).toContain('#EXT-X-BYTERANGE:157059@806');
      expect(result).toContain('#EXT-X-BYTERANGE:160000@157865');
      // Original local filename gone
      expect(result).not.toMatch(/^data\.m4s$/m);
    });

    it('preserves all non-data structural tags', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:10',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-MAP:URI="data.m4s",BYTERANGE="806@0"',
        '#EXTINF:6.000000,',
        '#EXT-X-BYTERANGE:1000@806',
        'data.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const mapping: SegmentBlobMapping = {
        dataObjectId: 'id',
        dataFilename: 'data.m4s',
      };
      const result = rewriteVariantPlaylist(content, mapping, BASE_URL);

      expect(result).toContain('#EXTM3U');
      expect(result).toContain('#EXT-X-VERSION:7');
      expect(result).toContain('#EXT-X-TARGETDURATION:10');
      expect(result).toContain('#EXT-X-MEDIA-SEQUENCE:0');
      expect(result).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
      expect(result).toContain('#EXT-X-ENDLIST');
    });

    it('does not replace data filename when it appears as a substring in a comment', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="data.m4s",BYTERANGE="806@0"',
        '# Comment about data.m4s embedded in text',
        '#EXTINF:6.000000,',
        '#EXT-X-BYTERANGE:1000@806',
        'data.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const mapping: SegmentBlobMapping = {
        dataObjectId: 'id',
        dataFilename: 'data.m4s',
      };
      const result = rewriteVariantPlaylist(content, mapping, BASE_URL);

      // Comment line untouched (regex anchors on full line)
      expect(result).toContain('# Comment about data.m4s embedded in text');
    });

    it('handles filenames with regex special characters', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="my[odd]name.m4s",BYTERANGE="100@0"',
        '#EXTINF:1.0,',
        '#EXT-X-BYTERANGE:200@100',
        'my[odd]name.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const mapping: SegmentBlobMapping = {
        dataObjectId: 'special-id',
        dataFilename: 'my[odd]name.m4s',
      };
      const result = rewriteVariantPlaylist(content, mapping, BASE_URL);

      expect(result).toContain(`#EXT-X-MAP:URI="${BASE_URL}/v1/objects/special-id"`);
      expect(result).toContain(`${BASE_URL}/v1/objects/special-id`);
    });
  });

  describe('rewriteMasterPlaylist', () => {
    it('rewrites variant playlist paths to gateway URLs', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
        '1080p/playlist.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720',
        '720p/playlist.m3u8',
      ].join('\n');

      const map = new Map([
        ['1080p/playlist.m3u8', 'sia-1080p'],
        ['720p/playlist.m3u8', 'sia-720p'],
      ]);
      const result = rewriteMasterPlaylist(content, map, BASE_URL);

      expect(result).toContain(`${BASE_URL}/v1/objects/sia-1080p`);
      expect(result).toContain(`${BASE_URL}/v1/objects/sia-720p`);
      expect(result).not.toMatch(/^1080p\/playlist\.m3u8$/m);
      expect(result).not.toMatch(/^720p\/playlist\.m3u8$/m);
    });

    it('preserves STREAM-INF tags', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
        '1080p/playlist.m3u8',
      ].join('\n');

      const map = new Map([['1080p/playlist.m3u8', 'sia-1080p']]);
      const result = rewriteMasterPlaylist(content, map, BASE_URL);
      expect(result).toContain('#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080');
    });

    it('leaves unmapped paths unchanged', () => {
      const content = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
        '1080p/playlist.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720',
        '720p/playlist.m3u8',
      ].join('\n');

      const map = new Map([['1080p/playlist.m3u8', 'sia-1080p']]);
      const result = rewriteMasterPlaylist(content, map, BASE_URL);
      expect(result).toContain(`${BASE_URL}/v1/objects/sia-1080p`);
      expect(result).toContain('720p/playlist.m3u8');
    });
  });
});

describe('parseMasterVariants', () => {
  it('pairs each STREAM-INF with its variant path, resolution and bitrate', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-STREAM-INF:BANDWIDTH=6420000,AVERAGE-BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      '1080p/playlist.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=856000,RESOLUTION=640x360,CODECS="avc1.42c015"',
      '360p/playlist.m3u8',
    ].join('\n');

    expect(parseMasterVariants(master)).toEqual([
      { path: '1080p/playlist.m3u8', width: 1920, height: 1080, bandwidthKbps: 6420 },
      { path: '360p/playlist.m3u8', width: 640, height: 360, bandwidthKbps: 856 },
    ]);
  });

  it('returns null dimensions when a STREAM-INF has no RESOLUTION', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"',
      'audio/playlist.m3u8',
    ].join('\n');

    expect(parseMasterVariants(master)).toEqual([
      { path: 'audio/playlist.m3u8', width: null, height: null, bandwidthKbps: 128 },
    ]);
  });
});
