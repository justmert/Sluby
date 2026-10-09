import { Routes, Route, Navigate, useLocation } from 'react-router';
import { type ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { OperatorOnly } from '@/components/layout/OperatorOnly';
import { RouteSuspense } from '@/components/layout/RouteSuspense';
import { PageTransition } from '@/components/motion/PageTransition';
import { ROUTES } from '@/lib/constants';
import { lazyPage, PAGE_CHUNKS } from '@/lib/page-chunks';
import { LEGACY_PATHS, legacyRedirect } from '@/lib/redirects';
import { useSession } from '@/lib/session';

const NotFoundPage = lazyPage(PAGE_CHUNKS.notFound);

const Overview = lazyPage(PAGE_CHUNKS.overview);
const Videos = lazyPage(PAGE_CHUNKS.videos);
const Video = lazyPage(PAGE_CHUNKS.video);
const Quickstart = lazyPage(PAGE_CHUNKS.quickstart);
const ApiKeys = lazyPage(PAGE_CHUNKS.apiKeys);
const Webhooks = lazyPage(PAGE_CHUNKS.webhooks);
const Webhook = lazyPage(PAGE_CHUNKS.webhook);
const Explorer = lazyPage(PAGE_CHUNKS.explorer);
const Health = lazyPage(PAGE_CHUNKS.health);
const Metrics = lazyPage(PAGE_CHUNKS.metrics);
const Settings = lazyPage(PAGE_CHUNKS.settings);

/**
 * An old url: replace it with where the page lives now, keeping its search
 * and hash (lib/redirects.ts). `fallback` renders when the path turns out to
 * be current, which only happens for /studio/settings without ?create=key.
 */
function Moved({ fallback = null }: { fallback?: ReactNode }) {
  const location = useLocation();
  const { operator } = useSession();
  const to = legacyRedirect(location, { operator });
  return to ? <Navigate to={to} replace /> : fallback;
}

export function App() {
  return (
    <AppShell>
      {/* outside suspense: one fade per navigation covers the skeleton or the
          page, whichever shows first. inside, the boundary unmounted the fade
          and the page blinked from skeleton to empty to page */}
      <PageTransition>
        <RouteSuspense>
          <Routes>
            <Route path="/" element={<Navigate to={ROUTES.OVERVIEW} replace />} />

            <Route path={ROUTES.OVERVIEW} element={<Overview />} />
            <Route path={ROUTES.VIDEOS} element={<Videos />} />
            <Route path={`${ROUTES.VIDEOS}/:id`} element={<Video />} />

            <Route path={ROUTES.DEVELOPERS} element={<Quickstart />} />
            <Route path={ROUTES.API_KEYS} element={<ApiKeys />} />
            <Route path={ROUTES.WEBHOOKS} element={<Webhooks />} />
            <Route path={`${ROUTES.WEBHOOKS}/:id`} element={<Webhook />} />
            <Route path={ROUTES.EXPLORER} element={<Explorer />} />

            <Route
              path={ROUTES.DEPLOYMENT}
              element={
                <OperatorOnly>
                  <Health />
                </OperatorOnly>
              }
            />
            <Route
              path={ROUTES.METRICS}
              element={
                <OperatorOnly>
                  <Metrics />
                </OperatorOnly>
              }
            />

            <Route path={ROUTES.SETTINGS} element={<Moved fallback={<Settings />} />} />

            {/* new pages: add the route here and the chunk in lib/page-chunks.ts */}

            {LEGACY_PATHS.map((path) => (
              <Route key={path} path={path} element={<Moved fallback={<NotFoundPage />} />} />
            ))}

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </RouteSuspense>
      </PageTransition>
    </AppShell>
  );
}
