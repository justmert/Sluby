import { useLocation } from 'react-router';
import { AnalyticsLoading } from '@/components/dashboard/analytics-parts';
import { DashboardLoading } from '@/components/dashboard/dashboard-parts';
import { useRouteSkeletonVisibility } from '@/components/dashboard/live';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/session';
import { PageContainer } from './PageContainer';

// shaped like each page's first screen, so the page lands where the skeleton
// was instead of pushing everything down. the grids repeat the pages' own.

function Header({ action = false, back = false }: { action?: boolean; back?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-4 @xl/page:flex-row @xl/page:items-end @xl/page:justify-between">
      <div className="flex flex-col gap-2">
        {back && <Skeleton className="mb-2 h-4 w-16" />}
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {action && <Skeleton className="h-8 w-28" />}
    </div>
  );
}

const card = 'rounded-xl';

// the dashboard and analytics draw their own loading state, the same one
// the pages show while their data loads
function Dashboard() {
  const { operator } = useSession();
  useRouteSkeletonVisibility();
  return (
    <>
      <Header action />
      <DashboardLoading operator={operator} />
    </>
  );
}

function Assets() {
  return (
    <>
      <Header action />
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-full max-w-sm" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className={`aspect-video w-full ${card}`} />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </>
  );
}

function AssetDetail() {
  return (
    <>
      <Header back action />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className={`aspect-video w-full lg:col-span-2 ${card}`} />
        <Skeleton className={`h-[360px] ${card}`} />
      </div>
      <Skeleton className="mt-6 h-8 w-48" />
    </>
  );
}

function Player() {
  return (
    <>
      <Header />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className={`aspect-video w-full lg:col-span-2 ${card}`} />
        <Skeleton className={`h-[420px] ${card}`} />
      </div>
    </>
  );
}

function Upload() {
  return (
    <>
      <Header />
      <Skeleton className={`h-[290px] max-w-2xl ${card}`} />
    </>
  );
}

function Developer() {
  return (
    <>
      <Header />
      <Skeleton className={`h-[510px] ${card}`} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Skeleton className={`h-[300px] ${card}`} />
        <Skeleton className={`h-[300px] ${card}`} />
      </div>
    </>
  );
}

function Analytics() {
  const { operator } = useSession();
  useRouteSkeletonVisibility();
  return (
    <>
      <Header />
      <AnalyticsLoading operator={operator} />
    </>
  );
}

function Settings() {
  return (
    <>
      <Header />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className={`h-[320px] lg:col-span-2 ${card}`} />
        <div className="flex flex-col gap-4">
          <Skeleton className={`h-[128px] ${card}`} />
          <Skeleton className={`h-[296px] ${card}`} />
        </div>
      </div>
    </>
  );
}

const SKELETONS: Array<[RegExp, () => React.ReactNode]> = [
  [/^\/studio\/?$/, Dashboard],
  [/^\/studio\/assets\/?$/, Assets],
  [/^\/studio\/assets\/[^/]+\/?$/, AssetDetail],
  [/^\/studio\/player\/?$/, Player],
  [/^\/studio\/upload\/?$/, Upload],
  [/^\/studio\/developer\/?$/, Developer],
  [/^\/studio\/analytics\/?$/, Analytics],
  [/^\/studio\/settings\/?$/, Settings],
];

/**
 * What shows while a page's code loads. It waits 150 ms before fading in, so
 * a chunk that loads quickly never flashes a skeleton.
 */
export function RouteFallback() {
  const { pathname } = useLocation();
  const Shape = SKELETONS.find(([pattern]) => pattern.test(pathname))?.[1];
  return (
    <div
      data-slot="route-fallback"
      aria-busy="true"
      className="animate-in duration-200 ease-out-soft fade-in-0 animation-delay-150 fill-mode-backwards"
    >
      <span className="sr-only" role="status">
        Loading page
      </span>
      {Shape && (
        <PageContainer>
          <Shape />
        </PageContainer>
      )}
    </div>
  );
}
