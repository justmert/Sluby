/**
 * Page layout for every studio page.
 *
 * PageContainer: the page's width, padding and container. Props:
 * - children
 * - className, merged onto the outer element
 *
 * It is a named size container called `page`, so a page can lay out by the
 * room it really has instead of the viewport (the sidebar takes 48 to 256 px
 * of the viewport depending on its state). Use tailwind's container variants
 * with the `/page` name:
 *
 *   <div className="grid gap-4 @2xl/page:grid-cols-2 @5xl/page:grid-cols-3">
 *
 * The stock container sizes apply: @sm 24rem, @md 28rem, @lg 32rem, @xl 36rem,
 * @2xl 42rem, @3xl 48rem, @4xl 56rem, @5xl 64rem, @6xl 72rem, @7xl 80rem. They
 * measure the content box (inside the padding), at most 80rem (max-w-7xl) minus
 * the padding. Nested containers keep working; `/page` always means this one.
 *
 * Container size queries only read the width, so nothing about height or
 * stacking changes, and position: fixed children still place against the
 * viewport (checked in chrome).
 *
 * PageHeader: the page title row. Props:
 * - title
 * - description, optional, under the title
 * - actions, optional, at the end of the row on wide pages and under the
 *   title on narrow ones
 */
import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div
      data-slot="page-container"
      className={cn(
        '@container/page mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 @xl/page:flex-row @xl/page:items-end @xl/page:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
