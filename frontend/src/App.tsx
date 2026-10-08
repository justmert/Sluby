import { Routes, Route, Navigate } from 'react-router';
import { lazy, Suspense } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { RouteFallback } from '@/components/layout/RouteFallback';
import { PageTransition } from '@/components/motion/PageTransition';

const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

const StudioDashboard = lazy(() => import('@/pages/studio/DashboardPage'));
const StudioUpload = lazy(() => import('@/pages/studio/UploadPage'));
const StudioAssets = lazy(() => import('@/pages/studio/AssetsPage'));
const StudioAssetDetail = lazy(() => import('@/pages/studio/AssetDetailPage'));
const StudioPlayer = lazy(() => import('@/pages/studio/PlayerPage'));
const StudioDeveloper = lazy(() => import('@/pages/studio/DeveloperPage'));
const StudioAnalytics = lazy(() => import('@/pages/studio/AnalyticsPage'));
const StudioSettings = lazy(() => import('@/pages/studio/SettingsPage'));

export function App() {
  return (
    <AppShell>
      {/* inside suspense, so a lazy page fades in once it has loaded rather
          than the fallback fading in and the page popping in after it */}
      <Suspense fallback={<RouteFallback />}>
        <PageTransition>
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
        </PageTransition>
      </Suspense>
    </AppShell>
  );
}
