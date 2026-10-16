import type { ReactNode, Ref } from 'react';
import { X } from 'lucide-react';
import type { AccessTier } from '@sluby/sdk';
import type { AssetStats } from '@/hooks/useStats';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatCount } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ACCESS_FILTERS, ALL, GRID_SORTS, STATUS_FILTERS } from './filters';
import type { LibraryView } from './library-view';

export interface VideosToolbarProps {
  /** the Phone board: status pills instead of the search and selects */
  phone: boolean;
  view: LibraryView;
  q: string;
  status: string | undefined;
  tier: AccessTier | undefined;
  sortValue: string;
  /** counts for the pills; undefined while they load */
  stats: AssetStats | undefined;
  searchInput: string;
  searchRef?: Ref<HTMLInputElement>;
  /** the typed search has not settled into results yet */
  searching: boolean;
  onSearchInput: (value: string) => void;
  onSearchBlur: () => void;
  /** a select-all box for the grid, which has no header row; leave out when there is nothing to select */
  selectAll?: ReactNode;
  onStatus: (status: string | null) => void;
  onTier: (tier: string | null) => void;
  onSort: (sort: string) => void;
  onView: (view: LibraryView) => void;
  onClearFilters: () => void;
  onRemoveSearch: () => void;
}

/**
 * The filters above the library. Wide: the board's row of the search
 * field, the Status and Access selects (and the grid's select-all and sort)
 * and the Table or Grid switch. Phone: the status pills with their counts,
 * and a removable chip for a search or access filter set elsewhere.
 */
export function VideosToolbar({
  phone,
  view,
  q,
  status,
  tier,
  sortValue,
  stats,
  searchInput,
  searchRef,
  searching,
  onSearchInput,
  onSearchBlur,
  selectAll,
  onStatus,
  onTier,
  onSort,
  onView,
  onClearFilters,
  onRemoveSearch,
}: VideosToolbarProps) {
  const filtered = Boolean(q || status || tier);

  if (phone) {
    const byStatus = stats?.by_status;
    // all, the three a person looks for most, any other status with videos
    // in it, and the one in use
    const pills = [
      { value: ALL, label: 'All', count: stats?.total },
      ...STATUS_FILTERS.filter(
        (f) =>
          f.value === status ||
          f.value === 'ready' ||
          f.value === 'processing' ||
          f.value === 'failed' ||
          (byStatus?.[f.value] ?? 0) > 0,
      ).map((f) => ({ value: f.value, label: f.label, count: byStatus?.[f.value] })),
    ];
    return (
      <div className="-mx-4 flex flex-col gap-2">
        <ToggleGroup
          type="single"
          variant="pill"
          spacing={2}
          value={status ?? ALL}
          aria-label="Filter by status"
          className="w-full px-4 py-0.5"
          onValueChange={(v) => onStatus(!v || v === ALL ? null : v)}
        >
          {pills.map((pill) => (
            <ToggleGroupItem key={pill.value} value={pill.value}>
              {pill.label}
              {pill.count !== undefined && (
                <span className="tabular-nums">{formatCount(pill.count)}</span>
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* a search or access filter set elsewhere (a link, the wider layout)
            stays visible here, and one tap takes it off */}
        {(q || tier) && (
          <div className="flex flex-wrap gap-2 px-4">
            {q && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                aria-label={`Remove search “${q}”`}
                onClick={onRemoveSearch}
              >
                <span className="max-w-48 truncate" dir="auto">
                  “{q}”
                </span>
                <X aria-hidden="true" />
              </Button>
            )}
            {tier && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                aria-label={`Remove the ${tier} filter`}
                onClick={() => onTier(null)}
              >
                {tier === 'private' ? 'Private' : 'Public'}
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-0 flex-[1_1_260px] @2xl/page:max-w-90">
        <Input
          ref={searchRef}
          type="search"
          placeholder="Search by title or ID"
          aria-label="Search videos"
          aria-keyshortcuts="/"
          value={searchInput}
          className={cn(searching && 'pr-9')}
          onChange={(e) => onSearchInput(e.target.value)}
          onBlur={onSearchBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && searchInput) {
              e.preventDefault();
              onSearchInput('');
            }
          }}
        />
        {searching && (
          <Spinner
            aria-label="Searching"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
          />
        )}
      </div>
      <label className="flex items-center gap-2 text-muted-foreground">
        Status
        <Select value={status ?? ALL} onValueChange={(v) => onStatus(v === ALL ? null : v)}>
          <SelectTrigger aria-label="Filter by status" className="w-35 text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2 text-muted-foreground">
        Access
        <Select value={tier ?? ALL} onValueChange={(v) => onTier(v === ALL ? null : v)}>
          <SelectTrigger aria-label="Filter by access" className="w-30 text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            {ACCESS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {view === 'grid' && selectAll}
      {view === 'grid' && (
        <label className="flex items-center gap-2 text-muted-foreground">
          Sort
          <Select value={sortValue} onValueChange={onSort}>
            <SelectTrigger aria-label="Sort" className="w-auto min-w-36 text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRID_SORTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onClearFilters}
        >
          Clear filters
        </Button>
      )}
      <ToggleGroup
        type="single"
        variant="segmented"
        value={view}
        aria-label="View"
        className="ml-auto"
        onValueChange={(v) => {
          if (v === 'table' || v === 'grid') onView(v);
        }}
      >
        <ToggleGroupItem value="table">Table</ToggleGroupItem>
        <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

/** The grid's select-all box, which sits in the toolbar since the grid has no header row. */
export function GridSelectAll({
  checked,
  onCheckedChange,
}: {
  checked: boolean | 'indeterminate';
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <label className="flex h-9 cursor-pointer items-center gap-2 text-muted-foreground">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-label="Select all on this page"
      />
      <span aria-hidden="true">Select all</span>
    </label>
  );
}
