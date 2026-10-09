import { useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResponsiveCell, ResponsiveTable } from '@/components/ui/responsive-table';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { InlineError } from './InlineError';
import { selectRange } from './select-range';

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  column: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** the column name in front of the value on phones; defaults to the header when it is a string */
  label?: string;
  /** the row's title: first on phones, bold, and the name used for its checkbox and menu */
  primary?: boolean;
  /** a header click sorts by this column (the page does the sorting, see onSortChange) */
  sortable?: boolean;
  /** numbers and sizes align right */
  align?: 'left' | 'right';
  /** extra classes for this column's cells */
  className?: string;
  /** a width class for the column, such as `w-32`; with `layout="fixed"` the other columns share what is left */
  width?: string;
  /** hide the column while the table is narrower than this container size (see BREAKPOINT) */
  hideBelow?: TableBreakpoint;
  /** leave the column out of the phone cards, e.g. when the primary cell already shows it there */
  hideInCards?: boolean;
}

/**
 * Container sizes a column can wait for. They measure the table itself, not
 * the window, so a table in a narrow card or beside a sidebar drops columns
 * when it has to (A11Y-07). Full class names, so tailwind sees them.
 */
const BREAKPOINT = {
  xl: 'hidden @xl/table:table-cell',
  '2xl': 'hidden @2xl/table:table-cell',
  '3xl': 'hidden @3xl/table:table-cell',
  '4xl': 'hidden @4xl/table:table-cell',
  '5xl': 'hidden @5xl/table:table-cell',
} as const;
export type TableBreakpoint = keyof typeof BREAKPOINT;

export interface RowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** red, and set apart below a separator */
  destructive?: boolean;
  disabled?: boolean;
}

export interface DataTableProps<T> {
  /** names the table for screen readers: "Videos", "API keys" */
  caption: string;
  columns: DataTableColumn<T>[];
  /** undefined while the first load runs: skeleton rows show instead */
  rows: T[] | undefined;
  getRowId: (row: T) => string;
  /** a short name for a row, for its checkbox and its menu ("Product walkthrough") */
  getRowLabel: (row: T) => string;
  sort?: SortState;
  /** called with the next sort when a sortable header is clicked; first click is descending for right-aligned (numeric) columns */
  onSortChange?: (sort: SortState) => void;
  /** turns on the checkbox column; the set holds row ids */
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** the row's menu; destructive actions go last, after a separator */
  rowActions?: (row: T) => RowAction[];
  /** filters, search and view switches above the table */
  toolbar?: ReactNode;
  /** a failed load: with no rows it replaces the body, with stale rows it shows above them */
  error?: unknown;
  onRetry?: () => unknown;
  retrying?: boolean;
  /** what failed to load, for the error title: "your videos" */
  what?: string;
  /** shown when rows is empty, usually an EmptyState */
  empty?: ReactNode;
  /** skeleton rows while loading (default 5) */
  loadingRows?: number;
  /** marks rows, e.g. a row that is being deleted */
  rowClassName?: (row: T) => string | undefined;
  /** `fixed` keeps long cells from widening the table past its box; give columns a `width` */
  layout?: 'auto' | 'fixed';
  /** a refetch is running over rows already shown */
  busy?: boolean;
  /**
   * Rows that leave fade out and the rest slide up. With `staggerIn` the rows
   * present at mount also enter one after another; leave it off when the
   * rows are not new to the reader (a cached list, a sort, another page).
   */
  animateRows?: boolean;
  staggerIn?: boolean;
  /**
   * Names the set of rows: a new search, sort or page. A new key swaps the
   * rows in place with no motion (the header and its focus stay), while rows
   * leaving under the same key animate out.
   */
  rowsKey?: string;
  className?: string;
}

const labelOf = <T,>(c: DataTableColumn<T>) =>
  c.label ?? (typeof c.header === 'string' ? c.header : undefined);

function SortHeader<T>({
  column,
  sort,
  onSortChange,
}: {
  column: DataTableColumn<T>;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
}) {
  const active = sort?.column === column.id;
  const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  const next: SortState = active
    ? { column: column.id, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
    : { column: column.id, direction: column.align === 'right' ? 'desc' : 'asc' };
  return (
    <button
      type="button"
      onClick={() => onSortChange?.(next)}
      className={cn(
        '-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none',
        active && 'text-foreground',
        column.align === 'right' && 'flex-row-reverse',
      )}
    >
      {column.header}
      <Icon aria-hidden="true" className={cn('size-3.5', !active && 'opacity-50')} />
    </button>
  );
}

function RowMenu({ actions, label }: { actions: RowAction[]; label: string }) {
  const normal = actions.filter((a) => !a.destructive);
  const danger = actions.filter((a) => a.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        {normal.map((a) => (
          <DropdownMenuItem key={a.label} onSelect={a.onSelect} disabled={a.disabled}>
            <a.icon aria-hidden="true" />
            {a.label}
          </DropdownMenuItem>
        ))}
        {normal.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map((a) => (
          <DropdownMenuItem
            key={a.label}
            variant="destructive"
            onSelect={a.onSelect}
            disabled={a.disabled}
          >
            <a.icon aria-hidden="true" />
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The studio's table: sortable headers, a checkbox column with shift-click
 * ranges, a row menu, a toolbar, and its own loading, empty and error
 * states. When the table itself is narrower than 640px (a phone, or a narrow
 * card on a wide screen) each row turns into a small card (ResponsiveTable),
 * the primary column on top and the menu pinned to the right; columns can
 * also drop out by the table's width (`hideBelow`). Sorting and filtering
 * stay with the page (usually in the url), so the table only reports clicks.
 *
 *   <DataTable
 *     caption="API keys"
 *     rows={keys.data}
 *     getRowId={(k) => k.id}
 *     getRowLabel={(k) => k.name}
 *     columns={[
 *       { id: 'name', header: 'Name', primary: true, cell: (k) => k.name },
 *       { id: 'created', header: 'Created', sortable: true, cell: (k) => formatDate(k.created_at) },
 *       { id: 'status', header: 'Status', cell: (k) => <StatusBadge kind="key" status="active" /> },
 *     ]}
 *     rowActions={(k) => [{ label: 'Revoke', icon: Trash2, destructive: true, onSelect: () => ask(k) }]}
 *     error={keys.error} onRetry={keys.refetch} what="your API keys"
 *     empty={<EmptyState icon={KeyRound} title="No API keys yet" ... />}
 *   />
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  getRowLabel,
  sort,
  onSortChange,
  selected,
  onSelectedChange,
  rowActions,
  toolbar,
  error,
  onRetry,
  retrying,
  what,
  empty,
  loadingRows = 5,
  rowClassName,
  layout = 'auto',
  busy = false,
  animateRows = false,
  staggerIn = false,
  rowsKey = '',
  className,
}: DataTableProps<T>) {
  const selectable = selected !== undefined && onSelectedChange !== undefined;
  const loading = rows === undefined && !error;
  const failed = rows === undefined && error != null;
  const ids = rows?.map(getRowId) ?? [];
  const selectedHere = ids.filter((id) => selected?.has(id)).length;
  const allState: boolean | 'indeterminate' =
    selectedHere === 0 ? false : selectedHere === ids.length ? true : 'indeterminate';
  const span = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  const toggleAll = () => {
    if (!onSelectedChange || !selected) return;
    const next = new Set(selected);
    if (allState === true) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onSelectedChange(next);
  };
  // the last row toggled, and whether shift was down on the click that is
  // about to toggle a row (radix reports the click before the change)
  const anchor = useRef<string | null>(null);
  const shift = useRef(false);
  const toggle = (id: string) => {
    if (!onSelectedChange || !selected) return;
    const on = !selected.has(id);
    onSelectedChange(selectRange(ids, selected, shift.current ? anchor.current : null, id, on));
    anchor.current = id;
    shift.current = false;
  };
  const colClass = (c: DataTableColumn<T>) => c.hideBelow && BREAKPOINT[c.hideBelow];
  // rows present at mount stay put unless asked to stagger in; later ones
  // (a poll that brings a new row) fade in
  // the rows each set started with stay still; rows a later poll adds fade
  // in. the first set may stagger in when the page asks
  const [first] = useState(rowsKey);
  const [mounted, setMounted] = useState({ key: rowsKey, ids: new Set(ids) });
  const current = mounted.key === rowsKey ? mounted : { key: rowsKey, ids: new Set(ids) };
  if (current !== mounted) setMounted(current);
  const initialFor = (id: string) =>
    (staggerIn && rowsKey === first) || !current.ids.has(id) ? undefined : false;
  const Body = animateRows ? AnimatedList : TableBody;

  return (
    <div data-slot="data-table" className={cn('flex flex-col gap-3', className)}>
      {toolbar && (
        <div data-slot="data-table-toolbar" className="flex flex-wrap items-center gap-2">
          {toolbar}
        </div>
      )}
      {rows !== undefined && error != null && (
        <InlineError error={error} what={what} onRetry={onRetry} retrying={retrying} />
      )}
      {failed ? (
        <InlineError error={error} what={what} onRetry={onRetry} retrying={retrying} />
      ) : (
        <div className="@container/table overflow-hidden rounded-xl border bg-card">
          <ResponsiveTable
            data-responsive="container"
            aria-label={caption}
            aria-busy={loading || busy || undefined}
            className={cn(layout === 'fixed' && 'table-fixed')}
          >
            <TableHeader>
              <TableRow>
                {selectable && (
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allState}
                      onCheckedChange={toggleAll}
                      disabled={!rows || rows.length === 0}
                      aria-label="Select all on this page"
                    />
                  </TableHead>
                )}
                {columns.map((c, i) => (
                  <TableHead
                    key={c.id}
                    aria-sort={
                      sort?.column === c.id
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                    className={cn(
                      c.align === 'right' && 'text-right',
                      i === 0 && !selectable && 'pl-4',
                      c.width,
                      colClass(c),
                      c.className,
                    )}
                  >
                    {c.sortable && onSortChange ? (
                      <SortHeader column={c} sort={sort} onSortChange={onSortChange} />
                    ) : (
                      c.header
                    )}
                  </TableHead>
                ))}
                {rowActions && (
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <Body
              key={rowsKey}
              {...(animateRows
                ? {
                    as: 'tbody' as const,
                    'data-slot': 'table-body',
                    className: '[&_tr:last-child]:border-0',
                  }
                : {})}
            >
              {loading &&
                Array.from({ length: loadingRows }, (_, r) => (
                  <TableRow key={r} className="hover:bg-transparent">
                    {selectable && (
                      <TableCell className="pl-4">
                        <Skeleton className={cn('size-4', lateReveal)} />
                      </TableCell>
                    )}
                    {columns.map((c, i) => (
                      <TableCell
                        key={c.id}
                        data-card-hidden={c.hideInCards || undefined}
                        className={cn(i === 0 && !selectable && 'pl-4', colClass(c))}
                      >
                        <Skeleton
                          className={cn(
                            'h-4',
                            c.primary ? 'w-40' : 'w-16',
                            c.align === 'right' && 'ml-auto',
                            lateReveal,
                          )}
                        />
                      </TableCell>
                    ))}
                    {rowActions && <TableCell className="pr-4" />}
                  </TableRow>
                ))}
              {rows?.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={span} className="p-0 whitespace-normal">
                    {empty ?? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Nothing here yet.
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              )}
              {rows?.map((row) => {
                const id = getRowId(row);
                const label = getRowLabel(row);
                const isSelected = selected?.has(id) ?? false;
                const cells = (
                  <>
                    {selectable && (
                      <ResponsiveCell cell="select" className="pl-4">
                        <Checkbox
                          checked={isSelected}
                          onClick={(e) => (shift.current = e.shiftKey)}
                          onCheckedChange={() => toggle(id)}
                          aria-label={`Select ${label}`}
                        />
                      </ResponsiveCell>
                    )}
                    {columns.map((c, i) => (
                      <ResponsiveCell
                        key={c.id}
                        cell={c.primary ? 'primary' : undefined}
                        label={c.primary ? undefined : labelOf(c)}
                        data-card-hidden={c.hideInCards || undefined}
                        className={cn(
                          c.align === 'right' && 'text-right tabular-nums',
                          c.primary && 'font-medium',
                          i === 0 && !selectable && 'pl-4',
                          colClass(c),
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </ResponsiveCell>
                    ))}
                    {rowActions && (
                      <ResponsiveCell cell="actions" className="pr-4 text-right">
                        <RowMenu actions={rowActions(row)} label={label} />
                      </ResponsiveCell>
                    )}
                  </>
                );
                return animateRows ? (
                  <AnimatedItem
                    key={id}
                    as="tr"
                    initial={initialFor(id)}
                    data-slot="table-row"
                    data-state={isSelected ? 'selected' : undefined}
                    className={cn(
                      'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
                      rowClassName?.(row),
                    )}
                  >
                    {cells}
                  </AnimatedItem>
                ) : (
                  <TableRow
                    key={id}
                    data-state={isSelected ? 'selected' : undefined}
                    className={rowClassName?.(row)}
                  >
                    {cells}
                  </TableRow>
                );
              })}
            </Body>
          </ResponsiveTable>
        </div>
      )}
    </div>
  );
}
