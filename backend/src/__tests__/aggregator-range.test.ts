import { describe, it, expect, vi } from 'vitest';
import {
  parseRange,
  isManifestContent,
  detectBinaryContentType,
} from '../delivery/aggregator.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

/** Object size used across the range cases: byte offsets 0..99. */
const TOTAL = 100;

describe('parseRange', () => {
  describe('absent or unusable headers', () => {
    it('returns null when no Range header was sent', () => {
      expect(parseRange(undefined, TOTAL)).toBeNull();
    });

    it('returns null for an empty header string', () => {
      expect(parseRange('', TOTAL)).toBeNull();
    });

    it('returns null for a garbage header', () => {
      expect(parseRange('not-a-range', TOTAL)).toBeNull();
      expect(parseRange('bytes=abc-def', TOTAL)).toBeNull();
      expect(parseRange('bytes=', TOTAL)).toBeNull();
      expect(parseRange('items=0-10', TOTAL)).toBeNull();
    });

    it('returns null for a multi-range request (we serve single ranges only)', () => {
      // RFC 7233 allows `bytes=0-1,5-6`; we do not build multipart/byteranges
      // responses, so the header is ignored and the caller falls back to 200.
      expect(parseRange('bytes=0-1,5-6', TOTAL)).toBeNull();
    });

    it('returns null (not 416) for an inverted range, per RFC 7233', () => {
      // first-byte-pos > last-byte-pos is an *invalid* byte-range-spec, which
      // must be ignored rather than answered with 416.
      expect(parseRange('bytes=50-10', TOTAL)).toBeNull();
      expect(parseRange('bytes=99-0', TOTAL)).toBeNull();
    });
  });

  describe('explicit ranges: bytes=N-M', () => {
    it('parses a window in the middle of the object', () => {
      expect(parseRange('bytes=10-19', TOTAL)).toEqual({
        start: 10,
        end: 19,
        chunkLength: 10,
      });
    });

    it('parses the whole object', () => {
      expect(parseRange('bytes=0-99', TOTAL)).toEqual({
        start: 0,
        end: 99,
        chunkLength: 100,
      });
    });

    it('parses a single-byte range with chunkLength 1 (no off-by-one)', () => {
      expect(parseRange('bytes=0-0', TOTAL)).toEqual({
        start: 0,
        end: 0,
        chunkLength: 1,
      });
      expect(parseRange('bytes=99-99', TOTAL)).toEqual({
        start: 99,
        end: 99,
        chunkLength: 1,
      });
    });

    it('clamps an end beyond the object to totalLength - 1', () => {
      expect(parseRange('bytes=90-100000', TOTAL)).toEqual({
        start: 90,
        end: 99,
        chunkLength: 10,
      });
    });

    it('clamps an end exactly one past the last byte', () => {
      expect(parseRange('bytes=0-100', TOTAL)).toEqual({
        start: 0,
        end: 99,
        chunkLength: 100,
      });
    });
  });

  describe('open-ended ranges: bytes=N-', () => {
    it('runs from N to the final byte', () => {
      expect(parseRange('bytes=40-', TOTAL)).toEqual({
        start: 40,
        end: 99,
        chunkLength: 60,
      });
    });

    it('bytes=0- is the entire object', () => {
      expect(parseRange('bytes=0-', TOTAL)).toEqual({
        start: 0,
        end: 99,
        chunkLength: 100,
      });
    });

    it('bytes=<last>- yields exactly one byte', () => {
      expect(parseRange('bytes=99-', TOTAL)).toEqual({
        start: 99,
        end: 99,
        chunkLength: 1,
      });
    });
  });

  describe('suffix ranges: bytes=-N (the LAST N bytes)', () => {
    it('returns the final N bytes, not the first N', () => {
      expect(parseRange('bytes=-20', TOTAL)).toEqual({
        start: 80,
        end: 99,
        chunkLength: 20,
      });
    });

    it('returns the single final byte for bytes=-1', () => {
      expect(parseRange('bytes=-1', TOTAL)).toEqual({
        start: 99,
        end: 99,
        chunkLength: 1,
      });
    });

    it('clamps start to 0 when the suffix is larger than the object', () => {
      expect(parseRange('bytes=-500', TOTAL)).toEqual({
        start: 0,
        end: 99,
        chunkLength: 100,
      });
    });

    it('returns the whole object when the suffix equals the object size', () => {
      expect(parseRange('bytes=-100', TOTAL)).toEqual({
        start: 0,
        end: 99,
        chunkLength: 100,
      });
    });

    it('returns null for a zero-length suffix (bytes=-0)', () => {
      expect(parseRange('bytes=-0', TOTAL)).toBeNull();
    });

    it('is unsatisfiable against a zero-length object', () => {
      expect(parseRange('bytes=-10', 0)).toBe('unsatisfiable');
    });
  });

  describe('unsatisfiable ranges', () => {
    it("returns 'unsatisfiable' when start equals totalLength", () => {
      expect(parseRange('bytes=100-150', TOTAL)).toBe('unsatisfiable');
    });

    it("returns 'unsatisfiable' when start is past the end of the object", () => {
      expect(parseRange('bytes=5000-6000', TOTAL)).toBe('unsatisfiable');
    });

    it('treats the last valid offset as satisfiable', () => {
      expect(parseRange('bytes=99-', TOTAL)).toEqual({
        start: 99,
        end: 99,
        chunkLength: 1,
      });
    });

    // An open-ended range starting at or past EOF is out of range, so it must
    // be 416 'unsatisfiable' and NOT "ignore the header" (which would serve the
    // whole object with 200). This is why the out-of-range guard is evaluated
    // before the inverted-spec guard in aggregator.ts.
    it('returns unsatisfiable for an open-ended range starting at or past the end', () => {
      expect(parseRange('bytes=100-', TOTAL)).toBe('unsatisfiable');
      expect(parseRange('bytes=5000-', TOTAL)).toBe('unsatisfiable');
      // the explicit form on the same object agrees
      expect(parseRange('bytes=100-150', TOTAL)).toBe('unsatisfiable');
    });
  });

  describe('chunkLength arithmetic', () => {
    it('is always end - start + 1 across every satisfiable form', () => {
      const headers = [
        'bytes=0-0',
        'bytes=0-99',
        'bytes=10-19',
        'bytes=40-',
        'bytes=99-',
        'bytes=-1',
        'bytes=-20',
        'bytes=-500',
        'bytes=90-100000',
      ];

      for (const header of headers) {
        const parsed = parseRange(header, TOTAL);
        expect(parsed, header).not.toBeNull();
        expect(parsed, header).not.toBe('unsatisfiable');
        const range = parsed as { start: number; end: number; chunkLength: number };
        expect(range.chunkLength, header).toBe(range.end - range.start + 1);
        expect(range.start, header).toBeGreaterThanOrEqual(0);
        expect(range.end, header).toBeLessThanOrEqual(TOTAL - 1);
        expect(range.chunkLength, header).toBeGreaterThan(0);
      }
    });

    it('never reports more bytes than the object holds', () => {
      const parsed = parseRange('bytes=0-999999', TOTAL);
      expect(parsed).toEqual({ start: 0, end: 99, chunkLength: TOTAL });
    });

    it('works on a realistic multi-megabyte object', () => {
      const size = 12 * 1024 * 1024; // one Sia slab
      expect(parseRange('bytes=0-1048575', size)).toEqual({
        start: 0,
        end: 1_048_575,
        chunkLength: 1_048_576,
      });
      expect(parseRange('bytes=-1048576', size)).toEqual({
        start: size - 1_048_576,
        end: size - 1,
        chunkLength: 1_048_576,
      });
    });
  });
});

describe('isManifestContent', () => {
  function bytesOf(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(text, 'utf8'));
  }

  it('is true for an m3u8 payload starting with #EXTM3U', () => {
    expect(isManifestContent(bytesOf('#EXTM3U\n#EXT-X-VERSION:3\n'))).toBe(true);
  });

  it('is true for a master playlist with variant streams', () => {
    const master =
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n360p.m3u8\n';
    expect(isManifestContent(bytesOf(master))).toBe(true);
  });

  it('is false for input that is too short even if it starts with #E', () => {
    expect(isManifestContent(bytesOf('#E'))).toBe(false);
    expect(isManifestContent(bytesOf('#EXTM3'))).toBe(false);
  });

  it('is false for an empty buffer', () => {
    expect(isManifestContent(new Uint8Array())).toBe(false);
  });

  it('is false for binary content of ample length', () => {
    // An fMP4 init segment: size box + "ftyp".
    const mp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);
    expect(isManifestContent(mp4)).toBe(false);
  });

  it('is false for text that starts with # but not #E', () => {
    expect(isManifestContent(bytesOf('# just a comment line\n'))).toBe(false);
  });

  it('is false for JSON of ample length', () => {
    expect(isManifestContent(bytesOf('{"hello":"world","n":1}'))).toBe(false);
  });
});

describe('detectBinaryContentType', () => {
  it('detects JPEG from the ff d8 ff magic', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(detectBinaryContentType(jpeg)).toBe('image/jpeg');
  });

  it('detects a minimal 3-byte JPEG header', () => {
    expect(detectBinaryContentType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(
      'image/jpeg',
    );
  });

  it('detects PNG from the full 8-byte signature', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    expect(detectBinaryContentType(png)).toBe('image/png');
  });

  it('does not accept a truncated PNG signature', () => {
    const truncated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]);
    expect(detectBinaryContentType(truncated)).toBe('application/octet-stream');
  });

  it('detects WebP from RIFF....WEBP', () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // R I F F
      0x24, 0x00, 0x00, 0x00, // little-endian file size
      0x57, 0x45, 0x42, 0x50, // W E B P
      0x56, 0x50, 0x38, 0x20, // VP8 chunk
    ]);
    expect(detectBinaryContentType(webp)).toBe('image/webp');
  });

  it('does not treat a non-WEBP RIFF container as WebP', () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // R I F F
      0x24, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // W A V E
    ]);
    expect(detectBinaryContentType(wav)).toBe('application/octet-stream');
  });

  it('detects GIF from the GIF8 magic', () => {
    const gif89a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    const gif87a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]); // GIF87a
    expect(detectBinaryContentType(gif89a)).toBe('image/gif');
    expect(detectBinaryContentType(gif87a)).toBe('image/gif');
  });

  it('requires at least 6 bytes before calling something a GIF', () => {
    // The magic is only 4 bytes but the guard demands a 6-byte header.
    expect(detectBinaryContentType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe(
      'application/octet-stream',
    );
  });

  it('falls back to application/octet-stream for unknown binary', () => {
    const mp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);
    expect(detectBinaryContentType(mp4)).toBe('application/octet-stream');
  });

  it('falls back for an empty buffer without throwing', () => {
    expect(detectBinaryContentType(new Uint8Array())).toBe(
      'application/octet-stream',
    );
  });

  it('falls back for a 1-byte buffer that merely shares a first magic byte', () => {
    expect(detectBinaryContentType(new Uint8Array([0xff]))).toBe(
      'application/octet-stream',
    );
    expect(detectBinaryContentType(new Uint8Array([0x89]))).toBe(
      'application/octet-stream',
    );
  });
});
