import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, ROUTES } from './constants';
import { chunkFor, PAGE_CHUNKS, preloadPage } from './page-chunks';

describe('page chunks', () => {
  it('knows the code for every page in the nav and the detail pages', () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(chunkFor(item.path)).toBeDefined();
    }
    expect(chunkFor(ROUTES.video('abc'))).toBe('video');
    expect(chunkFor(ROUTES.webhook('w1'))).toBe('webhook');
    expect(chunkFor('/studio/videos/abc/')).toBe('video');
    expect(chunkFor('/studio/videos?upload=1')).toBe('videos');
    expect(chunkFor('/elsewhere')).toBeUndefined();
    expect(chunkFor('/studio/assets')).toBeUndefined();
  });

  it('loads a real module with a page for every chunk', async () => {
    for (const load of Object.values(PAGE_CHUNKS)) {
      const mod = await load();
      expect(typeof mod.default).toBe('function');
    }
  });

  it('ignores a path no page serves', () => {
    expect(() => preloadPage('/nope')).not.toThrow();
  });
});
