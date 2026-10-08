import { describe, expect, it } from 'vitest';
import { getBreadcrumbs } from './breadcrumbs';

const studio = { label: 'Overview', path: '/studio' };
const assets = { label: 'Videos', path: '/studio/assets' };

describe('getBreadcrumbs', () => {
  it('maps studio sections', () => {
    expect(getBreadcrumbs('/studio')).toEqual([studio]);
    expect(getBreadcrumbs('/studio/settings')).toEqual([
      studio,
      { label: 'Settings', path: '/studio/settings' },
    ]);
  });

  it('names a video page by its title, never its id', () => {
    expect(getBreadcrumbs('/studio/assets/de4c25bb-d71d-4768', 'Keynote')).toEqual([
      studio,
      assets,
      { label: 'Keynote' },
    ]);
    expect(getBreadcrumbs('/studio/assets/de4c25bb-d71d-4768')).toEqual([
      studio,
      assets,
      { label: 'Video' },
    ]);
  });

  it('says not found for paths no route serves instead of echoing them', () => {
    expect(getBreadcrumbs('/studio/nope/deeper')).toEqual([studio, { label: 'Not found' }]);
    expect(getBreadcrumbs('/studio/upload/extra')).toEqual([
      studio,
      { label: 'Upload', path: '/studio/upload' },
      { label: 'Not found' },
    ]);
    expect(getBreadcrumbs('/studio/assets/a1/more')).toEqual([
      studio,
      assets,
      { label: 'Not found' },
    ]);
    expect(getBreadcrumbs('/elsewhere')).toEqual([{ label: 'Not found' }]);
    expect(getBreadcrumbs('/')).toEqual([]);
  });
});
