import { describe, expect, it } from 'vitest';
import { isNavActive, NAV_GROUPS, navItemsFor, ROUTES } from './constants';

const item = (label: string) => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.label === label)!;

describe('routes and nav', () => {
  it('builds detail paths with the id encoded', () => {
    expect(ROUTES.video('a1')).toBe('/studio/videos/a1');
    expect(ROUTES.video('a/b')).toBe('/studio/videos/a%2Fb');
    expect(ROUTES.webhook('w1')).toBe('/studio/developers/webhooks/w1');
  });

  it('hides the deployment group from members', () => {
    expect(navItemsFor(false).map((i) => i.label)).not.toContain('Health');
    expect(navItemsFor(true).map((i) => i.label)).toEqual([
      'Overview',
      'Videos',
      'Quickstart',
      'API keys',
      'Webhooks',
      'API explorer',
      'Health',
      'Metrics',
      'Settings',
    ]);
  });

  it('matches exact items on their own path and list items on their detail pages', () => {
    expect(isNavActive(item('Overview'), '/studio')).toBe(true);
    expect(isNavActive(item('Overview'), '/studio/videos')).toBe(false);
    expect(isNavActive(item('Videos'), '/studio/videos/a1')).toBe(true);
    expect(isNavActive(item('Videos'), '/studio/videosx')).toBe(false);
    expect(isNavActive(item('Quickstart'), '/studio/developers/')).toBe(true);
    expect(isNavActive(item('Quickstart'), '/studio/developers/keys')).toBe(false);
    expect(isNavActive(item('Health'), '/studio/deployment/metrics')).toBe(false);
  });
});
