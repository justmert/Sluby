import { describe, expect, it } from 'vitest';
import { getBreadcrumbs } from './TopBar';

describe('getBreadcrumbs', () => {
  it('maps studio sections and asset ids', () => {
    expect(getBreadcrumbs('/studio')).toEqual([{ label: 'Studio', path: '/studio' }]);
    expect(getBreadcrumbs('/studio/assets/abc')).toEqual([
      { label: 'Studio', path: '/studio' },
      { label: 'Assets', path: '/studio/assets' },
      { label: 'abc' },
    ]);
  });

  it('returns nothing outside the studio', () => {
    expect(getBreadcrumbs('/elsewhere')).toEqual([]);
  });
});
