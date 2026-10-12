import { useLocation } from 'react-router';
import { AssetDetailLoading } from '@/components/asset/AssetDetailLoading';
import { DashboardLoading } from '@/components/dashboard/dashboard-parts';
import { useRouteSkeletonVisibility } from '@/components/dashboard/live';
import {
  HealthCheckedLoading,
  HealthChipLoading,
  HealthLoading,
} from '@/components/deployment/HealthLoading';
import { MetricsLoading } from '@/components/deployment/MetricsCharts';
import { WEBHOOK_COLUMNS } from '@/components/developers/columns';
import { KeysLoading } from '@/components/developers/KeysLoading';
import { WebhookDetailLoading } from '@/components/developers/WebhookDetailLoading';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { SessionsSectionLoading } from '@/components/settings/SessionsHeader';
import { type ColumnFrame, withCells } from '@/components/shared/column-frames';
import { DataTable } from '@/components/shared/DataTable';
import { PageHeader, type PageHeaderProps } from '@/components/shared/PageHeader';
import { DropZone } from '@/components/upload/DropZone';
import { VideosLoading } from '@/components/videos/VideosLoading';
import { lateReveal } from '@/lib/motion';
import { useSession } from '@/lib/session';
import { ExplorerLoading } from '@/pages/studio/developers/explorer-parts';
import { QuickstartLoading } from '@/pages/studio/developers/quickstart-parts';
import { AddWebhookButton, BackToVideosButton } from './page-actions';
import { PAGE_HEADS } from './page-heads';
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

// the upload page's first draw needs nothing from the server: its header and
// the drop zone, with the limit it has not read yet left out of the hint
function Upload() {
  return (
    <>
      <Head {...PAGE_HEADS.upload} primaryAction={<BackToVideosButton />} />
      <DropZone onFiles={() => {}} busy={false} />
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

function Webhooks() {
  return (
    <>
      <Head {...PAGE_HEADS.webhooks} primaryAction={<AddWebhookButton />} />
      <TableSkeleton columns={WEBHOOK_COLUMNS} rows={3} />
    </>
  );
}

// the page's own first draw (P1), so the cards land where the skeleton was
function Health() {
  return (
    <>
      <Head
        title={PAGE_HEADS.health.title}
        className="mb-5"
        description={<HealthCheckedLoading />}
        secondaryActions={<HealthChipLoading />}
      />
      <HealthLoading />
    </>
  );
}

function Analytics() {
  return (
    <>
      <Head {...PAGE_HEADS.metrics} className="mb-5" />
      <MetricsLoading />
    </>
  );
}

// settings as the page draws it (SettingsPage): the account and appearance
// sections need nothing from the server, and the browsers list waits on it
function Settings() {
  const { authDisabled } = useSession();
  return (
    <>
      <Head {...PAGE_HEADS.settings} className="mb-2" />
      <AccountSection />
      {!authDisabled && <SessionsSectionLoading />}
      <AppearanceSection />
    </>
  );
}

const SKELETONS: Array<[RegExp, () => React.ReactNode, string?]> = [
  [/^\/studio\/?$/, Dashboard],
  [/^\/studio\/videos\/?$/, VideosLoading],
  // before the video page's pattern, which "upload" would match
  [/^\/studio\/videos\/upload\/?$/, Upload],
  [/^\/studio\/videos\/[^/]+\/?$/, AssetDetailLoading],
  [/^\/studio\/developers\/?$/, QuickstartLoading],
  [/^\/studio\/developers\/keys\/?$/, KeysLoading],
  [/^\/studio\/developers\/webhooks\/?$/, Webhooks],
  [/^\/studio\/developers\/webhooks\/[^/]+\/?$/, WebhookDetailLoading],
  [/^\/studio\/developers\/explorer\/?$/, ExplorerLoading],
  [/^\/studio\/deployment\/?$/, Health, 'max-w-400'],
  [/^\/studio\/deployment\/metrics\/?$/, Analytics],
  // settings is one narrow column (SettingsPage)
  [/^\/studio\/settings\/?$/, Settings, 'max-w-320'],
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
