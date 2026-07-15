import { describe, it, expect } from 'vitest';
import { contentTypeForHint } from '../delivery/content-type.js';

describe('contentTypeForHint', () => {
  it('maps the manifest hint to the HLS content type', () => {
    expect(contentTypeForHint('manifest')).toBe('application/vnd.apple.mpegurl');
  });

  it('maps the thumbnail hint to a JPEG content type', () => {
    expect(contentTypeForHint('thumbnail')).toBe('image/jpeg');
  });

  it('maps video/segment hints to fMP4', () => {
    expect(contentTypeForHint('video')).toBe('video/mp4');
    expect(contentTypeForHint('segment')).toBe('video/mp4');
  });

  it('returns null for unknown or missing hints so callers can fall back', () => {
    expect(contentTypeForHint(undefined)).toBeNull();
    expect(contentTypeForHint('')).toBeNull();
    expect(contentTypeForHint('bogus')).toBeNull();
  });
});
