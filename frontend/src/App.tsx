import { Routes, Route, Navigate, useLocation } from 'react-router';
import { type ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { OperatorOnly } from '@/components/layout/OperatorOnly';
import { RouteSuspense } from '@/components/layout/RouteSuspense';
import { PageTransition } from '@/components/motion/PageTransition';
import { ROUTES } from '@/lib/constants';
import { lazyPage, PAGE_CHUNKS } from '@/lib/page-chunks';
import { LEGACY_PATHS, legacyRedirect, uploadParamRedirect } from '@/lib/redirects';
import { useSession } from '@/lib/session';

const NotFoundPage = lazyPage(PAGE_CHUNKS.notFound);

const Overview = lazyPage(PAGE_CHUNKS.overview);
const Videos = lazyPage(PAGE_CHUNKS.videos);
const Video = lazyPage(PAGE_CHUNKS.video);
const Upload = lazyPage(PAGE_CHUNKS.upload);
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
  const location = useLocation();
  // the old upload sheet opened over any page with ?upload=1
  const toUpload = uploadParamRedirect(location);
  return (
    <AppShell>
      {/* outside suspense: one fade per navigation covers the skeleton or the
          page, whichever shows first. inside, the boundary unmounted the fade
          and the page blinked from skeleton to empty to page */}
      <PageTransition>
        <RouteSuspense>
          {/* case matters, as it does to nginx and the breadcrumbs: /STUDIO is not found */}
          {toUpload ? (
            <Navigate to={toUpload} replace />
          ) : (
            <Routes>
              <Route caseSensitive path="/" element={<Navigate to={ROUTES.OVERVIEW} replace />} />

              <Route caseSensitive path={ROUTES.OVERVIEW} element={<Overview />} />
              <Route caseSensitive path={ROUTES.VIDEOS} element={<Videos />} />
              {/* a static segment, which the router ranks above :id in any order */}
              <Route caseSensitive path={ROUTES.UPLOAD} element={<Upload />} />
              <Route caseSensitive path={`${ROUTES.VIDEOS}/:id`} element={<Video />} />

              <Route caseSensitive path={ROUTES.DEVELOPERS} element={<Quickstart />} />
              <Route caseSensitive path={ROUTES.API_KEYS} element={<ApiKeys />} />
              <Route caseSensitive path={ROUTES.WEBHOOKS} element={<Webhooks />} />
              <Route caseSensitive path={`${ROUTES.WEBHOOKS}/:id`} element={<Webhook />} />
              <Route caseSensitive path={ROUTES.EXPLORER} element={<Explorer />} />

              <Route
                caseSensitive
                path={ROUTES.DEPLOYMENT}
                element={
                  <OperatorOnly>
                    <Health />
                  </OperatorOnly>
                }
              />
              <Route
                caseSensitive
                path={ROUTES.METRICS}
                element={
                  <OperatorOnly>
                    <Metrics />
                  </OperatorOnly>
                }
              />

              <Route
                caseSensitive
                path={ROUTES.SETTINGS}
                element={<Moved fallback={<Settings />} />}
              />

              {/* new pages: add the route here and the chunk in lib/page-chunks.ts */}

              {LEGACY_PATHS.map((path) => (
                <Route
                  key={path}
                  caseSensitive
                  path={path}
                  element={<Moved fallback={<NotFoundPage />} />}
                />
              ))}

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          )}
        </RouteSuspense>
      </PageTransition>
    </AppShell>
  );
}
