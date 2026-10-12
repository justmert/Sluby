import '@/index.css';
import type { ComponentType } from 'react';
import { cleanup, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import DashboardPage from '@/pages/studio/DashboardPage';
import AssetsPage from '@/pages/studio/AssetsPage';
import AssetDetailPage from '@/pages/studio/AssetDetailPage';
import QuickstartPage from '@/pages/studio/developers/QuickstartPage';
import KeysPage from '@/pages/studio/developers/KeysPage';
import WebhooksPage from '@/pages/studio/developers/WebhooksPage';
import WebhookDetailPage from '@/pages/studio/developers/WebhookDetailPage';
import ExplorerPage from '@/pages/studio/developers/ExplorerPage';
import HealthPage from '@/pages/studio/deployment/HealthPage';
import MetricsPage from '@/pages/studio/deployment/MetricsPage';
import SettingsPage from '@/pages/studio/SettingsPage';
import UploadPage from '@/pages/studio/UploadPage';
import { RouteFallback } from './RouteFallback';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
const browser = () =>
  import('vitest/browser' as string) as Promise<{
    page: { viewport(width: number, height: number): Promise<void> };
  }>;

type Session = { operator: boolean; authDisabled: boolean };
const OPERATOR_SIGN_IN_OFF: Session = { operator: true, authDisabled: true };
const MEMBER: Session = { operator: false, authDisabled: false };

// [name, url, route pattern, page, session]
const PAGES: Array<[string, string, string, ComponentType, Session?]> = [
  ['overview', '/studio', '/studio', DashboardPage],
  ['videos', '/studio/videos', '/studio/videos', AssetsPage],
  ['videos grid', '/studio/videos?view=grid', '/studio/videos', AssetsPage],
  ['a video', '/studio/videos/a1', '/studio/videos/:id', AssetDetailPage],
  ['upload', '/studio/videos/upload', '/studio/videos/upload', UploadPage],
  ['quickstart', '/studio/developers', '/studio/developers', QuickstartPage],
  ['keys', '/studio/developers/keys', '/studio/developers/keys', KeysPage],
  ['webhooks', '/studio/developers/webhooks', '/studio/developers/webhooks', WebhooksPage],
  [
    'a webhook',
    '/studio/developers/webhooks/w1',
    '/studio/developers/webhooks/:id',
    WebhookDetailPage,
  ],
  ['explorer', '/studio/developers/explorer', '/studio/developers/explorer', ExplorerPage],
  ['health', '/studio/deployment', '/studio/deployment', HealthPage],
  ['metrics', '/studio/deployment/metrics', '/studio/deployment/metrics', MetricsPage],
  ['settings', '/studio/settings', '/studio/settings', SettingsPage],
  ['overview as a member', '/studio', '/studio', DashboardPage, MEMBER],
  ['settings with sign-in on', '/studio/settings', '/studio/settings', SettingsPage, MEMBER],
];

// a box people cannot see: a plain block that only stacks its children
const isWrapper = (el: Element) => {
  const style = getComputedStyle(el);
  return (
    el.tagName === 'DIV' &&
    style.display === 'block' &&
    style.borderTopWidth === '0px' &&
    style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
    style.paddingTop === '0px' &&
    el.children.length > 0
  );
};

// the boxes on the page's first screen, from the top of its container. what
// starts below the fold cannot be seen moving, and a box both shapes run past
// the fold with looks the same
const FOLD = 800;

function blocks(container: Element) {
  const top = container.getBoundingClientRect().top;
  const out: Array<{ top: number; height: number }> = [];
  const visit = (el: Element) => {
    for (const c of el.children) {
      if (c.classList.contains('sr-only') || getComputedStyle(c).position === 'absolute') continue;
      if (isWrapper(c)) {
        visit(c);
        continue;
      }
      const r = c.getBoundingClientRect();
      if (r.height === 0 || r.top - top >= FOLD) continue;
      out.push({ top: Math.round(r.top - top), height: Math.round(r.height) });
    }
  };
  visit(container);
  return out.map((b) => (b.top + b.height > FOLD ? { ...b, height: FOLD - b.top } : b));
}

async function shapes(
  url: string,
  pattern: string,
  Page: ComponentType,
  width: number,
  session: Session,
) {
  await (await browser()).page.viewport(width, 900);
  const fallback = renderPage(
    <WithSession {...session}>
      <RouteFallback />
    </WithSession>,
    { route: url },
  );
  await document.fonts.ready;
  const skeleton = blocks(
    fallback.container.querySelector('[data-slot="route-fallback"] [data-slot="page-container"]')!,
  );
  cleanup();
  const view = renderPage(
    <WithSession {...session}>
      <Routes>
        <Route path={pattern} element={<Page />} />
      </Routes>
    </WithSession>,
    { route: url },
  );
  const container = await waitFor(() => {
    const el = view.container.querySelector('[data-slot="page-container"]');
    expect(el).not.toBeNull();
    return el!;
  });
  // the first draw settles over a frame or two (measured widths, container queries)
  await new Promise((r) => setTimeout(r, 300));
  const loading = blocks(container);
  cleanup();
  return { skeleton, loading };
}

beforeAll(() => {
  // every request hangs, so each page stays on its loading state
  vi.stubGlobal('fetch', () => new Promise(() => {}));
});

afterEach(() => cleanup());

describe('route skeletons', () => {
  // 320 is the narrowest width the studio supports: page descriptions and
  // help text wrap there in every engine, so a skeleton that draws text as
  // fixed bars shows up whatever the scrollbar takes
  for (const width of [1200, 768, 390, 320]) {
    for (const [name, url, pattern, Page, session = OPERATOR_SIGN_IN_OFF] of PAGES) {
      it(`put ${name} at ${width} px in the boxes the page draws while it loads`, async () => {
        const { skeleton, loading } = await shapes(url, pattern, Page, width, session);
        // a pixel either way is how an engine rounds a text line
        expect(skeleton).toHaveLength(loading.length);
        skeleton.forEach((box, i) => {
          expect(Math.abs(box.top - loading[i].top), `box ${i} top`).toBeLessThanOrEqual(1);
          expect(Math.abs(box.height - loading[i].height), `box ${i} height`).toBeLessThanOrEqual(
            1,
          );
        });
      });
    }
  }
});
