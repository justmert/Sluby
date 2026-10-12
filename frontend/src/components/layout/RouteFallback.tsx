import { useLocation, useSearchParams } from 'react-router';
import { AssetDetailLoading } from '@/components/asset/AssetDetailLoading';
import { KEY_COLUMNS, WEBHOOK_COLUMNS } from '@/components/developers/columns';
import { VideoPickerSkeleton } from '@/components/developers/VideoPickerSkeleton';
import { WebhookDetailLoading } from '@/components/developers/WebhookDetailLoading';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { SESSION_COLUMNS } from '@/components/settings/columns';
import { SessionsHeader } from '@/components/settings/SessionsHeader';
import { SETTINGS_SECTION } from '@/components/settings/section';
import { type ColumnFrame, withCells } from '@/components/shared/column-frames';
import { DataTable } from '@/components/shared/DataTable';
import { PageHeader, type PageHeaderProps, SectionHeader } from '@/components/shared/PageHeader';
import { CopyField } from '@/components/shared/CopyField';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  KeysCountLoading,
  KeysRow,
  ReferenceLinks,
  ServerRow,
  TryExplorerLink,
} from '@/pages/studio/developers/quickstart-parts';
import { SETUP_DESCRIPTION } from '@/lib/snippet-copy';
import { AddWebhookButton, CreateKeyButton, StatsLinePlaceholder } from './page-actions';
import { PAGE_HEADS } from './page-heads';
import { lateReveal } from '@/lib/motion';
import { PageContainer } from './PageContainer';

// shaped like each page's first screen, so the page lands where the skeleton
// was instead of pushing everything down. the grids repeat the pages' own.

// the page's own header, title and description as the page writes them, so
// they wrap the same. the title is not an h1: the only h1 while the code
// loads is the "Loading page" one below, and the page brings its own
function Head(props: PageHeaderProps) {
  return (
    <PageHeader
      {...props}
      heading={
        <div dir="auto" className="truncate font-heading text-title">
          {props.title}
        </div>
      }
    />
  );
}

// the dashboard and analytics draw their own loading state, the same one
// the pages show while their data loads
function Dashboard() {
  const { operator } = useSession();
  return (
    <>
      <Head {...PAGE_HEADS.overview} />
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
      <Head {...PAGE_HEADS.videos} description={<StatsLinePlaceholder />} />
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

// the quickstart's own rows, links and text (quickstart-parts), with bars
// only where the page waits for data
function Quickstart() {
  return (
    <>
      <Head {...PAGE_HEADS.quickstart} />
      <Card>
        <CardContent>
          <dl className="divide-y">
            <ServerRow label="API base URL">
              <CopyField
                label="API base URL"
                value={window.location.origin}
                className="w-full max-w-md"
              />
            </ServerRow>
            <ServerRow label="API keys">
              <KeysRow count={<KeysCountLoading />} />
            </ServerRow>
            <ServerRow label="Reference">
              <ReferenceLinks />
            </ServerRow>
          </dl>
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
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm text-muted-foreground">{SETUP_DESCRIPTION}</p>
            <Skeleton className="h-80 rounded-lg" />
          </div>
        </CardContent>
      </Card>
      <TryExplorerLink />
    </>
  );
}

function Keys() {
  return (
    <>
      <Head {...PAGE_HEADS.keys} primaryAction={<CreateKeyButton />} />
      <TableSkeleton columns={KEY_COLUMNS} rows={3} />
    </>
  );
}

function Webhooks() {
  return (
    <>
      <Head {...PAGE_HEADS.webhooks} primaryAction={<AddWebhookButton />} />
      <TableSkeleton columns={WEBHOOK_COLUMNS} rows={3} />
    </>
  );
}

// the type of a form label (ui/label), without the label code
const LABEL = 'flex items-center gap-2 text-sm leading-5 font-medium';

// the explorer's form as it first draws (ExplorerPage): its labels and text,
// with bars for the controls
function Explorer() {
  return (
    <>
      <Head {...PAGE_HEADS.explorer} />
      <div className="grid items-start gap-4 @4xl/page:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
            <CardDescription>
              Sent with your session, so it can change real data. See the{' '}
              <span className="inline-flex items-center gap-1 underline underline-offset-4">
                API reference
                <span className="size-3" />
              </span>{' '}
              for every endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="grid gap-2">
                <div className={LABEL}>Template</div>
                <Skeleton className={control} />
              </div>
              <div className="grid grid-cols-1 items-end gap-2 @[16rem]/page:grid-cols-[7rem_minmax(0,1fr)] @lg/page:grid-cols-[7rem_minmax(0,1fr)_auto]">
                <div className="grid gap-2">
                  <div className={LABEL}>Method</div>
                  <Skeleton className={control} />
                </div>
                <div className="grid min-w-0 gap-2">
                  <div className={LABEL}>Path</div>
                  <Skeleton className={control} />
                </div>
                <Skeleton
                  className={cn(
                    control,
                    '@[16rem]/page:col-span-2 @lg/page:col-span-1 @lg/page:w-24',
                  )}
                />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Response</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="py-8 text-center text-sm text-muted-foreground">
              Send a request to see the answer here.
            </p>
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
      <Head {...PAGE_HEADS.health} meta={<Skeleton className="h-5.5 w-28 rounded-full" />} />
      <HealthLoading />
    </>
  );
}

function Analytics() {
  const { operator } = useSession();
  return (
    <>
      <Head {...PAGE_HEADS.metrics} />
      <AnalyticsLoading operator={operator} />
    </>
  );
}

// settings as the page draws it (SettingsPage): the account and appearance
// sections need nothing from the server, and the browsers list waits on it
function Settings() {
  const { authDisabled, username } = useSession();
  return (
    <>
      <Head {...PAGE_HEADS.settings} />
      <div className="flex flex-col gap-6">
        <AccountSection />
        {!authDisabled && (
          <section className={SETTINGS_SECTION}>
            <SessionsHeader username={username} />
            <TableSkeleton columns={SESSION_COLUMNS} rows={2} />
          </section>
        )}
        <AppearanceSection />
      </div>
    </>
  );
}

const SKELETONS: Array<[RegExp, () => React.ReactNode, string?]> = [
  [/^\/studio\/?$/, Dashboard],
  [/^\/studio\/videos\/?$/, Assets],
  [/^\/studio\/videos\/[^/]+\/?$/, AssetDetailLoading],
  [/^\/studio\/developers\/?$/, Quickstart],
  [/^\/studio\/developers\/keys\/?$/, Keys],
  [/^\/studio\/developers\/webhooks\/?$/, Webhooks],
  [/^\/studio\/developers\/webhooks\/[^/]+\/?$/, WebhookDetailLoading],
  [/^\/studio\/developers\/explorer\/?$/, Explorer],
  [/^\/studio\/deployment\/?$/, Health],
  [/^\/studio\/deployment\/metrics\/?$/, Analytics],
  // settings is one narrow column (SettingsPage)
  [/^\/studio\/settings\/?$/, Settings, 'max-w-240'],
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
