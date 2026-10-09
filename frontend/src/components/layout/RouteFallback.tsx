import { useLocation, useSearchParams } from 'react-router';
import { AssetDetailLoading } from '@/components/asset/AssetDetailLoading';
import { KEY_COLUMNS, WEBHOOK_COLUMNS } from '@/components/developers/columns';
import { VideoPickerSkeleton } from '@/components/developers/VideoPicker';
import { WebhookDetailLoading } from '@/components/developers/WebhookDetailLoading';
import { SESSION_COLUMNS } from '@/components/settings/columns';
import { type ColumnFrame, withCells } from '@/components/shared/column-frames';
import { DataTable } from '@/components/shared/DataTable';
import { DescriptionItem, DescriptionList } from '@/components/shared/DescriptionList';
import { SectionHeader } from '@/components/shared/PageHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { libraryView } from '@/components/videos/library-view';
import { VideosGridSkeleton } from '@/components/videos/VideosGridSkeleton';
import { VideosTable } from '@/components/videos/VideosTable';
import { cn } from '@/lib/utils';
import { AnalyticsLoading } from '@/components/dashboard/analytics-parts';
import { DashboardLoading } from '@/components/dashboard/dashboard-parts';
import { HealthLoading } from '@/components/deployment/HealthLoading';
import { useRouteSkeletonVisibility } from '@/components/dashboard/live';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/session';
import { KeyNote } from '@/pages/studio/developers/KeyNote';
import { lateReveal } from '@/lib/motion';
import { PageContainer } from './PageContainer';

// shaped like each page's first screen, so the page lands where the skeleton
// was instead of pushing everything down. the grids repeat the pages' own.

function Header({
  action = false,
  meta = false,
}: {
  action?: boolean;
  /** a status badge under the description, as Health has */
  meta?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 @xl/page:flex-row @xl/page:items-end @xl/page:justify-between">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
        {meta && <Skeleton className="h-5.5 w-28 rounded-full" />}
      </div>
      {action && <Skeleton className="h-8 w-28 pointer-coarse:h-10" />}
    </div>
  );
}

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

// the toolbar's controls: 32 px, 40 on touch screens like the real ones
const control = 'h-8 pointer-coarse:h-10';

function Assets() {
  const [params] = useSearchParams();
  const param = params.get('view');
  const grid =
    libraryView(param === 'table' || param === 'grid' || param === 'list' ? param : undefined) ===
    'grid';
  return (
    <>
      <Header action />
      {/* the page's toolbar box, control for control (AssetsPage) */}
      <div className="-mx-2 mb-3 flex flex-col gap-2 px-2 py-2 @2xl/page:flex-row @2xl/page:items-center">
        <Skeleton className={cn(control, 'w-full @2xl/page:max-w-sm')} />
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* select all; on small phones the grid shows only its box */}
          <Skeleton
            className={cn(
              control,
              'w-24',
              grid ? 'max-[27rem]:w-7' : 'hidden @max-[calc(40rem+2px)]/page:block',
            )}
          />
          <Skeleton className={cn(control, 'w-20 @2xl/page:hidden')} />
          <Skeleton className={cn(control, 'hidden w-40 @2xl/page:block')} />
          <Skeleton className={cn(control, 'hidden w-32 @2xl/page:block')} />
          {grid && <Skeleton className={cn(control, 'w-34')} />}
          <Skeleton className={cn(control, 'ml-auto w-16')} />
        </div>
      </div>
      {grid ? (
        <VideosGridSkeleton />
      ) : (
        <VideosTable
          assets={undefined}
          sort={{ column: 'created', direction: 'desc' }}
          onSortChange={() => {}}
          selected={new Set()}
          onSelectedChange={() => {}}
          actions={() => []}
          staggerIn={false}
          busy
          rowsKey="loading"
        />
      )}
    </>
  );
}

// a table page's own table with no rows yet: its headers over skeleton rows
function TableSkeleton({ columns, rows }: { columns: readonly ColumnFrame[]; rows: number }) {
  return (
    <DataTable
      caption=""
      columns={withCells<never>(columns, {})}
      rows={undefined}
      getRowId={() => ''}
      getRowLabel={() => ''}
      loadingRows={rows}
      rowActions={() => []}
    />
  );
}

// a row of the quickstart's server card (QuickstartPage)
function ServerRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 py-3 first:pt-0 last:pb-0 @2xl/page:grid-cols-[10rem_1fr] @2xl/page:items-center @2xl/page:gap-4">
      <Skeleton className="my-0.5 h-4 w-24" />
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Quickstart() {
  return (
    <>
      <Header />
      <Card>
        <CardContent>
          <div className="divide-y">
            <ServerRow>
              <Skeleton className={cn(control, 'w-full max-w-md')} />
            </ServerRow>
            <ServerRow>
              <Skeleton className="mr-auto h-4 w-24" />
              <Skeleton className="h-7 w-28 pointer-coarse:h-9" />
              <Skeleton className="h-7 w-24 pointer-coarse:h-9" />
            </ServerRow>
            <ServerRow>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {['w-26', 'w-24', 'w-32'].map((w) => (
                  <Skeleton key={w} className={cn('my-0.5 h-4', w)} />
                ))}
              </div>
            </ServerRow>
          </div>
        </CardContent>
      </Card>
      <SectionHeader title="Code" description="Snippets for this server, ready to copy" />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="pb-1">
            <Skeleton className="h-8 w-full max-w-2xl" />
          </div>
          <div className="flex flex-col gap-2">
            <VideoPickerSkeleton />
            <KeyNote />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="my-0.5 h-4 w-96 max-w-full" />
            <Skeleton className="h-80 rounded-lg" />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// a list page with one table: keys, webhooks
function ListPage({ columns }: { columns: readonly ColumnFrame[] }) {
  return (
    <>
      <Header action />
      <TableSkeleton columns={columns} rows={3} />
    </>
  );
}

function Explorer() {
  return (
    <>
      <Header />
      <div className="grid items-start gap-4 @4xl/page:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
            <CardDescription>
              Sent with your session, so it can change real data. See the{' '}
              <span className="inline-flex items-center gap-1">
                API reference
                <span className="size-3" />
              </span>{' '}
              for every endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Skeleton className="my-0.5 h-4 w-20" />
              <Skeleton className={control} />
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-end gap-2 @lg/page:grid-cols-[7rem_minmax(0,1fr)_auto]">
              <div className="grid gap-2">
                <Skeleton className="my-0.5 h-4 w-16" />
                <Skeleton className={control} />
              </div>
              <div className="grid gap-2">
                <Skeleton className="my-0.5 h-4 w-12" />
                <Skeleton className={control} />
              </div>
              <Skeleton className={cn(control, 'col-span-2 @lg/page:col-span-1 @lg/page:w-24')} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Response</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center py-8">
              <Skeleton className="my-0.5 h-4 w-64 max-w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
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

// account, signed-in browsers and appearance (SettingsPage), each a heading
// over a card, with the same lines of text
function Settings() {
  const { authDisabled, operator, username } = useSession();
  const twoLines = (
    <span className="flex flex-col gap-0.5">
      <Skeleton className="my-0.5 h-4 w-48" />
      <Skeleton className="my-0.5 h-3 w-64 max-w-full" />
    </span>
  );
  return (
    <>
      <Header />
      <div className="flex flex-col gap-10">
        <section>
          <SectionHeader title="Account" />
          <Card>
            <CardContent>
              <DescriptionList>
                <DescriptionItem label="Account">
                  <Skeleton className="my-1 h-3 w-24" />
                </DescriptionItem>
                <DescriptionItem label={authDisabled ? 'Sign-in' : 'Signed in with'}>
                  {authDisabled ? twoLines : <Skeleton className="my-0.5 h-4 w-16" />}
                </DescriptionItem>
                <DescriptionItem label="Role">
                  {operator ? twoLines : <Skeleton className="my-0.5 h-4 w-16" />}
                </DescriptionItem>
              </DescriptionList>
            </CardContent>
            {!authDisabled && (
              <CardFooter>
                <Skeleton className="h-7 w-24 pointer-coarse:h-9" />
              </CardFooter>
            )}
          </Card>
        </section>
        {!authDisabled && (
          <section>
            <SectionHeader
              title="Signed-in browsers"
              description={
                <>
                  Where you are signed in as <span dir="auto">{username}</span>.
                </>
              }
              action={<Skeleton className="h-7 w-40 pointer-coarse:h-9" />}
            />
            <TableSkeleton columns={SESSION_COLUMNS} rows={2} />
          </section>
        )}
        <section>
          <SectionHeader
            title="Appearance"
            description="Follows your system by default. Your choice is saved in this browser."
          />
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Skeleton className="my-0.5 h-4 w-12" />
              <Skeleton className={cn(control, 'w-60')} />
              <Skeleton className="my-0.5 h-4 w-44" />
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}

const SKELETONS: Array<[RegExp, () => React.ReactNode, string?]> = [
  [/^\/studio\/?$/, Dashboard],
  [/^\/studio\/videos\/?$/, Assets],
  [/^\/studio\/videos\/[^/]+\/?$/, AssetDetailLoading],
  [/^\/studio\/developers\/?$/, Quickstart],
  [/^\/studio\/developers\/keys\/?$/, () => <ListPage columns={KEY_COLUMNS} />],
  [/^\/studio\/developers\/webhooks\/?$/, () => <ListPage columns={WEBHOOK_COLUMNS} />],
  [/^\/studio\/developers\/webhooks\/[^/]+\/?$/, WebhookDetailLoading],
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
          {/* real headings and table headers take part in the shapes; the
              status above is what assistive tech gets */}
          <div aria-hidden="true" inert>
            <Shape />
          </div>
        </PageContainer>
      )}
    </div>
  );
}
