import { useSearchParams } from 'react-router';
import type { AccessTier } from '@sluby/sdk';
import { StatsLinePlaceholder } from '@/components/layout/page-actions';
import { PAGE_HEADS } from '@/components/layout/page-heads';
import { PageHeader } from '@/components/shared/PageHeader';
import { useMediaQuery } from '@/hooks/use-mobile';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ACCESS_FILTERS, GRID_SORTS, PHONE_QUERY, STATUS_FILTERS } from './filters';
import { libraryView } from './library-view';
import { VideosCardsSkeleton } from './VideosCards';
import { VideosGridSkeleton } from './VideosGridSkeleton';
import { VideosTable } from './VideosTable';
import { VideosToolbar } from './VideosToolbar';

const noop = () => {};

/**
 * The Videos page as it first draws, for the route skeleton while the page's
 * code loads: the same header, the toolbar the url asks for, and the table,
 * grid or phone cards with placeholder rows. It is laid out in plain block
 * flow with the page's 20px gaps as margins, so it sits in the route
 * skeleton's container exactly where the page's flex column puts its parts.
 * The title is not an h1: the route skeleton's "Loading page" is the one h1
 * until the page arrives.
 */
export function VideosLoading() {
  const [params] = useSearchParams();
  const phone = useMediaQuery(PHONE_QUERY);
  const param = params.get('view');
  const view = libraryView(
    param === 'table' || param === 'grid' || param === 'list' ? param : undefined,
  );
  const status = STATUS_FILTERS.find((f) => f.value === params.get('status'))?.value;
  const tier = ACCESS_FILTERS.find((f) => f.value === params.get('tier'))?.value as
    AccessTier | undefined;
  const sort = GRID_SORTS.find((s) => s.value === params.get('sort'))?.value ?? 'created_at:desc';
  const q = params.get('q') ?? '';
  return (
    <>
      <PageHeader
        {...PAGE_HEADS.videos}
        className={phone ? 'sr-only' : 'mb-0'}
        heading={
          <div dir="auto" className="truncate font-heading text-title">
            {PAGE_HEADS.videos.title}
          </div>
        }
        description={<StatsLinePlaceholder className={lateReveal} />}
      />
      {/* the page's header leaves the flow on a phone, so the toolbar starts at the top */}
      <div className={cn('text-sm', !phone && 'mt-5')}>
        <VideosToolbar
          phone={phone}
          view={view}
          q={q}
          status={status}
          tier={tier}
          sortValue={sort}
          stats={undefined}
          searchInput={q}
          searching={false}
          onSearchInput={noop}
          onSearchBlur={noop}
          onStatus={noop}
          onTier={noop}
          onSort={noop}
          onView={noop}
          onClearFilters={noop}
          onRemoveSearch={noop}
        />
      </div>
      <div className="mt-5 text-sm">
        {phone ? (
          <VideosCardsSkeleton />
        ) : view === 'grid' ? (
          <VideosGridSkeleton />
        ) : (
          <VideosTable
            assets={undefined}
            sort={{ column: 'created', direction: 'desc' }}
            onSortChange={noop}
            selected={new Set()}
            onSelectedChange={noop}
            actions={() => []}
            staggerIn={false}
            busy
            rowsKey="loading"
          />
        )}
      </div>
    </>
  );
}
