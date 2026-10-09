import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** the page's h1; a string gets a tooltip with the full text when it truncates */
  title: ReactNode;
  /** one fragment under the title, 70 characters at most, no period */
  description?: ReactNode;
  /** a row under the title for status and facts: badges, "0:10 · 1080p" */
  meta?: ReactNode;
  /** above the title, e.g. a back link on phones; the top bar already has breadcrumbs */
  breadcrumbs?: ReactNode;
  /** the page's one primary action, rightmost */
  primaryAction?: ReactNode;
  /** outline or ghost buttons and menus, left of the primary action */
  secondaryActions?: ReactNode;
  /** @deprecated use primaryAction and secondaryActions; rendered as given */
  actions?: ReactNode;
  className?: string;
}

/**
 * The title block every page starts with: h1, description, an optional meta
 * row, and the actions. Wide pages put the actions at the end of the title
 * row; narrow ones (by the page container, not the viewport) put them under
 * it. Actions follow one order everywhere: secondary first, primary last.
 *
 *   <PageHeader
 *     title="Videos"
 *     description="Your library"
 *     secondaryActions={<Button variant="outline">Export</Button>}
 *     primaryAction={<Button><Upload />Upload video</Button>}
 *   />
 */
export function PageHeader({
  title,
  description,
  meta,
  breadcrumbs,
  primaryAction,
  secondaryActions,
  actions,
  className,
}: PageHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions || actions);
  return (
    <header
      data-slot="page-header"
      className={cn(
        'mb-6 flex flex-col gap-4 @xl/page:flex-row @xl/page:items-end @xl/page:justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {breadcrumbs && <div className="mb-2 text-sm text-muted-foreground">{breadcrumbs}</div>}
        {/* dir=auto: a right-to-left video title truncates at its end, not its start */}
        <h1
          dir="auto"
          className="truncate font-heading text-title"
          title={typeof title === 'string' ? title : undefined}
        >
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {meta && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
            {meta}
          </div>
        )}
      </div>
      {hasActions && (
        <div data-slot="page-actions" className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  /** one line under the title in muted text */
  description?: ReactNode;
  /** a button or link at the end of the row, such as "View all" */
  action?: ReactNode;
  /** the heading level; h2 for sections of a page, h3 inside a card */
  as?: 'h2' | 'h3';
  /** the heading's id, for aria-labelledby on the section */
  id?: string;
  className?: string;
}

/**
 * The heading over a group of cards or a block of a page: 16px semibold in
 * the heading family, which is never smaller than the card titles below it.
 * It brings its own rhythm (40px above, 12px below) and drops the top margin
 * when it is the first thing in its parent.
 *
 *   <section aria-labelledby="deployment">
 *     <SectionHeader id="deployment" title="Deployment" description="Only operators see this" />
 *     ...cards
 *   </section>
 */
export function SectionHeader({
  title,
  description,
  action,
  as: Heading = 'h2',
  id,
  className,
}: SectionHeaderProps) {
  return (
    <div
      data-slot="section-header"
      className={cn('mt-10 mb-3 flex items-end justify-between gap-4 first:mt-0', className)}
    >
      <div className="min-w-0">
        <Heading id={id} className="font-heading text-heading">
          {title}
        </Heading>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
