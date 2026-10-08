import { Routes, Route, Navigate } from 'react-router';
import { lazy } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { RouteSuspense } from '@/components/layout/RouteSuspense';
import { PageTransition } from '@/components/motion/PageTransition';
import { PAGE_CHUNKS } from '@/lib/page-chunks';

const NotFoundPage = lazy(PAGE_CHUNKS.notFound);

const StudioDashboard = lazy(PAGE_CHUNKS.dashboard);
const StudioUpload = lazy(PAGE_CHUNKS.upload);
const StudioAssets = lazy(PAGE_CHUNKS.assets);
const StudioAssetDetail = lazy(PAGE_CHUNKS.assetDetail);
const StudioPlayer = lazy(PAGE_CHUNKS.player);
const StudioDeveloper = lazy(PAGE_CHUNKS.developer);
const StudioAnalytics = lazy(PAGE_CHUNKS.analytics);
const StudioSettings = lazy(PAGE_CHUNKS.settings);

export function App() {
  return (
    <AppShell>
      {/* outside suspense: one fade per navigation covers the skeleton or the
          page, whichever shows first. inside, the boundary unmounted the fade
          and the page blinked from skeleton to empty to page */}
      <PageTransition>
        <RouteSuspense>
          <Routes>
            <Route path="/" element={<Navigate to="/studio" replace />} />

            <Route path="/studio" element={<StudioDashboard />} />
            <Route path="/studio/upload" element={<StudioUpload />} />
            <Route path="/studio/assets" element={<StudioAssets />} />
            <Route path="/studio/assets/:id" element={<StudioAssetDetail />} />
            <Route path="/studio/player" element={<StudioPlayer />} />
            <Route path="/studio/developer" element={<StudioDeveloper />} />
            <Route path="/studio/analytics" element={<StudioAnalytics />} />
            <Route path="/studio/settings" element={<StudioSettings />} />

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </RouteSuspense>
      </PageTransition>
    </AppShell>
  );
}
