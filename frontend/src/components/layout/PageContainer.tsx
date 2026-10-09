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
 * PageHeader and SectionHeader: see components/shared/PageHeader.tsx.
 */
import { useEffect, useRef, useState } from 'react';
import { routeSkeletonWasVisible } from '@/components/dashboard/live';
import { lateRevealSelector } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  // a page taking over from a route skeleton people already see draws its
  // own placeholders at once; their usual 150 ms wait would blink them out.
  // once those are gone, skeletons that show later (a refetch, a tab) wait
  // again, so a quick answer never flashes one
  const [instant, setInstant] = useState(routeSkeletonWasVisible);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!instant || !el) return;
    const settle = () => {
      if (el.querySelector(lateRevealSelector)) return false;
      setInstant(false);
      return true;
    };
    if (settle()) return;
    const observer = new MutationObserver(() => settle() && observer.disconnect());
    observer.observe(el, { childList: true, subtree: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [instant]);
  return (
    <div
      ref={ref}
      data-slot="page-container"
      data-instant-skeletons={instant || undefined}
      className={cn(
        '@container/page mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

// the page title block lives with the other shared components; it is
// re-exported here so existing imports keep working
export { PageHeader, SectionHeader } from '@/components/shared/PageHeader';
