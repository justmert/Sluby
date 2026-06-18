import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton } from '@/components/ui/skeleton';

const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

// Studio pages
const StudioDashboard = lazy(() => import('@/pages/studio/DashboardPage'));
const StudioUpload = lazy(() => import('@/pages/studio/UploadPage'));
const StudioAssets = lazy(() => import('@/pages/studio/AssetsPage'));
const StudioAssetDetail = lazy(() => import('@/pages/studio/AssetDetailPage'));
const StudioPlayer = lazy(() => import('@/pages/studio/PlayerPage'));
const StudioDeveloper = lazy(() => import('@/pages/studio/DeveloperPage'));
const StudioAnalytics = lazy(() => import('@/pages/studio/AnalyticsPage'));
const StudioSettings = lazy(() => import('@/pages/studio/SettingsPage'));

function PageFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-3 w-48" />
    </div>
  );
}

export function App() {
  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/studio" replace />} />

          {/* Studio routes */}
          <Route path="/studio" element={<StudioDashboard />} />
          <Route path="/studio/upload" element={<StudioUpload />} />
          <Route path="/studio/assets" element={<StudioAssets />} />
          <Route path="/studio/assets/:id" element={<StudioAssetDetail />} />
          <Route path="/studio/player" element={<StudioPlayer />} />
          <Route path="/studio/developer" element={<StudioDeveloper />} />
          <Route path="/studio/analytics" element={<StudioAnalytics />} />
          <Route path="/studio/settings" element={<StudioSettings />} />

          {/* Catch-all */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
