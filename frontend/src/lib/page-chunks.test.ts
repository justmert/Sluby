import { describe, expect, it } from 'vitest';
import { STUDIO_NAV } from './constants';
import { chunkFor, preloadPage } from './page-chunks';

describe('page chunks', () => {
  it('knows the code for every page in the nav and the video page', () => {
    for (const item of STUDIO_NAV) expect(chunkFor(item.path)).toBeDefined();
    expect(chunkFor('/studio/assets/abc')).toBe('assetDetail');
    expect(chunkFor('/elsewhere')).toBeUndefined();
  });

  it('ignores a path no page serves', () => {
    expect(() => preloadPage('/nope')).not.toThrow();
  });
});
