import { useLocation } from 'react-router';
import { AnalyticsLoading } from '@/components/dashboard/analytics-parts';
import { DashboardLoading } from '@/components/dashboard/dashboard-parts';
import { HealthLoading } from '@/components/deployment/HealthLoading';
import { useRouteSkeletonVisibility } from '@/components/dashboard/live';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/session';
import { lateReveal } from '@/lib/motion';
import { PageContainer } from './PageContainer';

// shaped like each page's first screen, so the page lands where the skeleton
// was instead of pushing everything down. the grids repeat the pages' own.

function Header({
  action = false,
  back = false,
  meta = false,
}: {
  action?: boolean;
  back?: boolean;
  /** a status badge under the description, as Health has */
  meta?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 @xl/page:flex-row @xl/page:items-end @xl/page:justify-between">
      <div className="flex flex-col gap-2">
        {back && <Skeleton className="mb-2 h-4 w-16" />}
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
        {meta && <Skeleton className="h-5.5 w-28 rounded-full" />}
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

function Quickstart() {
  return (
    <>
      <Header />
      <Skeleton className={`h-[510px] ${card}`} />
    </>
  );
}

// a list page with one card: keys, webhooks
function ListPage() {
  return (
    <>
      <Header />
      <Skeleton className={`h-[300px] ${card}`} />
    </>
  );
}

function WebhookDetail() {
  return (
    <>
      <Header />
      <Skeleton className={`h-[160px] ${card}`} />
      <Skeleton className={`mt-10 h-[240px] ${card}`} />
    </>
  );
}

function Explorer() {
  return (
    <>
      <Header />
      <Skeleton className={`h-[420px] ${card}`} />
    </>
  );
}

// the page's own first draw (P1), so the cards land where the skeleton was
function Health() {
  return (
    <>
      <Header meta />
      <HealthLoading />
    </>
  );
}

function Analytics() {
  const { operator } = useSession();
  return (
    <>
      <Header />
      <AnalyticsLoading operator={operator} />
    </>
  );
}

// account, signed-in browsers and appearance, each a heading over a card
function Settings() {
  const { authDisabled } = useSession();
  const section = (height: string) => (
    <div>
      <Skeleton className="mb-3 h-6 w-36" />
      <Skeleton className={`${height} ${card}`} />
    </div>
  );
  return (
    <>
      <Header />
      <div className="flex flex-col gap-10">
        {section(authDisabled ? 'h-[178px]' : 'h-[198px]')}
        {!authDisabled && section('h-[150px]')}
        {section('h-[66px]')}
      </div>
    </>
  );
}

const SKELETONS: Array<[RegExp, () => React.ReactNode, string?]> = [
  [/^\/studio\/?$/, Dashboard],
  [/^\/studio\/videos\/?$/, Assets],
  [/^\/studio\/videos\/[^/]+\/?$/, AssetDetail],
  [/^\/studio\/developers\/?$/, Quickstart],
  [/^\/studio\/developers\/(keys|webhooks)\/?$/, ListPage],
  [/^\/studio\/developers\/webhooks\/[^/]+\/?$/, WebhookDetail],
  [/^\/studio\/developers\/explorer\/?$/, Explorer],
  [/^\/studio\/deployment\/?$/, Health],
  [/^\/studio\/deployment\/metrics\/?$/, Analytics],
  // settings is one narrow column (SettingsPage)
  [/^\/studio\/settings\/?$/, Settings, 'max-w-3xl'],
];

/**
 * What shows while a page's code loads. It waits 150 ms before fading in, so
 * a chunk that loads quickly never flashes a skeleton. It sits inside
 * PageTransition, so when the page replaces it there is no second fade.
 */
export function RouteFallback() {
  const { pathname } = useLocation();
  // every page draws its own placeholders where these were (PageContainer)
  useRouteSkeletonVisibility();
  const [, Shape, width] = SKELETONS.find(([pattern]) => pattern.test(pathname)) ?? [];
  return (
    <div data-slot="route-fallback" aria-busy="true" className={lateReveal}>
      {/* the page's own h1 replaces this one once its code arrives */}
      <h1 className="sr-only">Loading page</h1>
      <span className="sr-only" role="status">
        Loading page
      </span>
      {Shape && (
        <PageContainer className={width}>
          <Shape />
        </PageContainer>
      )}
    </div>
  );
}
