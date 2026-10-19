import { describe, expect, it } from 'vitest';
import { legacyRedirect, uploadParamRedirect } from './redirects';

const at = (url: string, admin = false) => {
  const u = new URL(url, 'https://studio.example.com');
  return legacyRedirect({ pathname: u.pathname, search: u.search, hash: u.hash }, { admin });
};

describe('legacyRedirect', () => {
  it.each([
    ['/studio/assets', '/studio/videos'],
    ['/studio/assets/', '/studio/videos'],
    ['/studio/assets?q=Bunny&status=ready&page=2', '/studio/videos?q=Bunny&status=ready&page=2'],
    ['/studio/assets/a1', '/studio/videos/a1'],
    ['/studio/assets/a1?tab=renditions#log', '/studio/videos/a1?tab=renditions#log'],
    ['/studio/upload', '/studio/videos/upload'],
    ['/studio/upload/', '/studio/videos/upload'],
    ['/studio/player', '/studio/videos?status=ready'],
    ['/studio/player?q=Keynote', '/studio/videos?q=Keynote&status=ready'],
    ['/studio/player?asset=f1', '/studio/videos/f1'],
    ['/studio/player?asset=f1&q=Ready', '/studio/videos/f1?q=Ready'],
    ['/studio/developer', '/studio/developers'],
    ['/studio/developer#snippets', '/studio/developers#snippets'],
    ['/studio/developer?create=webhook', '/studio/developers/webhooks?create=webhook'],
    ['/studio/settings?create=key', '/studio/developers/keys?create=key'],
  ])('sends %s to %s', (from, to) => {
    expect(at(from)).toBe(to);
    expect(at(from, true)).toBe(to);
  });

  it('sends analytics to metrics for an admin and to the overview for a member', () => {
    expect(at('/studio/analytics', true)).toBe('/studio/deployment/metrics');
    expect(at('/studio/analytics')).toBe('/studio');
    expect(at('/studio/analytics?range=1h', true)).toBe('/studio/deployment/metrics?range=1h');
  });

  it('keeps an encoded video id intact', () => {
    expect(at('/studio/assets/a%2Fb')).toBe('/studio/videos/a%2Fb');
  });

  it('leaves current paths alone', () => {
    for (const path of [
      '/studio',
      '/studio/videos',
      '/studio/videos/a1',
      '/studio/videos/upload',
      '/studio/settings',
      '/studio/settings?tab=x',
      '/studio/developers',
      '/studio/deployment/metrics',
      '/studio/assets/a1/extra',
      '/nope',
    ]) {
      expect(at(path)).toBeNull();
    }
  });
});

describe('uploadParamRedirect', () => {
  it('sends the old sheet param on any route to the upload page', () => {
    expect(uploadParamRedirect({ search: '?upload=1' })).toBe('/studio/videos/upload');
    expect(uploadParamRedirect({ search: '?view=grid&upload=1' })).toBe('/studio/videos/upload');
  });

  it('leaves other searches alone', () => {
    expect(uploadParamRedirect({ search: '' })).toBeNull();
    expect(uploadParamRedirect({ search: '?upload=0' })).toBeNull();
    expect(uploadParamRedirect({ search: '?q=upload' })).toBeNull();
  });
});
