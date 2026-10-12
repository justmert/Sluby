import { describe, expect, it } from 'vitest';
import { getBreadcrumbs } from './breadcrumbs';

const overview = { label: 'Overview', path: '/studio' };
const videos = { label: 'Videos', path: '/studio/videos' };
const webhooks = { label: 'Webhooks', path: '/studio/developers/webhooks' };

describe('getBreadcrumbs', () => {
  it('maps every page to the overview and its own name', () => {
    expect(getBreadcrumbs('/studio')).toEqual([overview]);
    expect(getBreadcrumbs('/studio/')).toEqual([overview]);
    expect(getBreadcrumbs('/studio/settings')).toEqual([
      overview,
      { label: 'Settings', path: '/studio/settings' },
    ]);
    expect(getBreadcrumbs('/studio/developers')).toEqual([
      overview,
      { label: 'Quickstart', path: '/studio/developers' },
    ]);
    expect(getBreadcrumbs('/studio/developers/keys')).toEqual([
      overview,
      { label: 'API keys', path: '/studio/developers/keys' },
    ]);
    expect(getBreadcrumbs('/studio/deployment')).toEqual([
      overview,
      { label: 'Health', path: '/studio/deployment' },
    ]);
    expect(getBreadcrumbs('/studio/deployment/metrics')).toEqual([
      overview,
      { label: 'Metrics', path: '/studio/deployment/metrics' },
    ]);
  });

  it('puts the upload page under videos, not as a video', () => {
    expect(getBreadcrumbs('/studio/videos/upload', 'Keynote')).toEqual([
      overview,
      videos,
      { label: 'Upload' },
    ]);
    expect(getBreadcrumbs('/studio/videos/upload/')).toEqual([
      overview,
      videos,
      { label: 'Upload' },
    ]);
  });

  it('names a detail page by its record, never its id', () => {
    expect(getBreadcrumbs('/studio/videos/de4c25bb-d71d-4768', 'Keynote')).toEqual([
      overview,
      videos,
      { label: 'Keynote' },
    ]);
    expect(getBreadcrumbs('/studio/videos/de4c25bb-d71d-4768')).toEqual([
      overview,
      videos,
      { label: 'Video' },
    ]);
    expect(getBreadcrumbs('/studio/developers/webhooks/w1', 'example.com/hook')).toEqual([
      overview,
      webhooks,
      { label: 'example.com/hook' },
    ]);
    expect(getBreadcrumbs('/studio/developers/webhooks/w1')).toEqual([
      overview,
      webhooks,
      { label: 'Webhook' },
    ]);
  });

  it('says not found for paths no route serves instead of echoing them', () => {
    expect(getBreadcrumbs('/studio/nope/deeper')).toEqual([overview, { label: 'Not found' }]);
    expect(getBreadcrumbs('/studio/settings/extra')).toEqual([
      overview,
      { label: 'Settings', path: '/studio/settings' },
      { label: 'Not found' },
    ]);
    expect(getBreadcrumbs('/studio/videos/a1/more')).toEqual([
      overview,
      videos,
      { label: 'Not found' },
    ]);
    expect(getBreadcrumbs('/elsewhere')).toEqual([{ label: 'Not found' }]);
    expect(getBreadcrumbs('/')).toEqual([]);
  });

  it('stays empty for an old url while it redirects', () => {
    expect(getBreadcrumbs('/studio/assets')).toEqual([]);
    expect(getBreadcrumbs('/studio/assets/a1')).toEqual([]);
    expect(getBreadcrumbs('/studio/upload')).toEqual([]);
    expect(getBreadcrumbs('/studio/analytics')).toEqual([]);
    expect(getBreadcrumbs('/studio/assets/a1/more')).toEqual([overview, { label: 'Not found' }]);
  });
});
