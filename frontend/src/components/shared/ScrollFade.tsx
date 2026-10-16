import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const FADE = '1.5rem';

/**
 * Wraps a sideways scroller (its one child, e.g. a tab strip that runs past
 * a phone's width) and fades whichever edge has more to scroll to, so the
 * strip shows it goes on. The fade is a mask on the scroller, so it works on
 * any surface behind it. A focused item scrolls clear of the fade.
 *
 *   <ScrollFade>
 *     <div className="overflow-x-auto">
 *       <TabsList>…</TabsList>
 *     </div>
 *   </ScrollFade>
 */
export function ScrollFade({
  children,
  className,
}: {
  children: React.ReactElement;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const scroller = ref.current?.firstElementChild as HTMLElement | null;
    if (!scroller) return;
    // the edges are read from the scroll position, so they follow a swipe,
    // a resize and tabs that come or go
    const update = () => {
      const left = scroller.scrollLeft;
      const room = scroller.scrollWidth - scroller.clientWidth;
      setEdges({ start: left > 1, end: room - left > 1 });
    };
    // a focused item scrolls fully past the fade, not only to the strip's edge
    scroller.style.scrollPaddingInline = FADE;
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      data-slot="scroll-fade"
      data-fade-start={edges.start || undefined}
      data-fade-end={edges.end || undefined}
      style={
        {
          '--fade-start': edges.start ? FADE : '0px',
          '--fade-end': edges.end ? FADE : '0px',
        } as React.CSSProperties
      }
      className={cn(
        '*:[mask-image:linear-gradient(to_right,transparent,#000_var(--fade-start),#000_calc(100%-var(--fade-end)),transparent)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
