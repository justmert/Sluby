import type { ReactNode } from 'react';
import { AnimatePresence, type TargetAndTransition } from 'motion/react';
import * as m from 'motion/react-m';
import { listContainer, listItem, spring } from '@/lib/motion';

// one fixed component per tag, looked up rather than built during render
const listTags = { ul: m.ul, ol: m.ol, div: m.div, tbody: m.tbody };
const itemTags = { li: m.li, div: m.div, article: m.article, tr: m.tr };

// the m components share one prop shape apart from the element type, and
// these wrappers only pass layout and html attributes through
type ListElement = typeof m.div;

interface AnimatedListProps extends Omit<React.ComponentProps<ListElement>, 'variants'> {
  as?: keyof typeof listTags;
  /**
   * "sync" keeps a leaving item in place until it has faded, then the rest
   * slide up. "popLayout" lifts it out at once so the rest move while it
   * fades; the list needs `position: relative` and it does not suit tables.
   */
  presence?: 'sync' | 'popLayout';
  children?: ReactNode;
}

/**
 * A list whose items stagger in on mount, fade in when added later, and
 * animate out when removed. Children must be `AnimatedItem`s with stable
 * keys (an id, never the index).
 */
export function AnimatedList({
  as = 'ul',
  presence = 'sync',
  children,
  ...props
}: AnimatedListProps) {
  const Comp = listTags[as] as ListElement;
  return (
    <Comp variants={listContainer} initial="hidden" animate="visible" {...props}>
      <AnimatePresence mode={presence}>{children}</AnimatePresence>
    </Comp>
  );
}

interface AnimatedItemProps extends Omit<React.ComponentProps<ListElement>, 'variants' | 'layout'> {
  as?: keyof typeof itemTags;
  /**
   * "position" (default) slides items to their new place when siblings come
   * or go without stretching their content; true also animates size; false
   * turns layout animation off.
   */
  layout?: boolean | 'position';
}

export function AnimatedItem({ as = 'li', layout = 'position', ...props }: AnimatedItemProps) {
  const Comp = itemTags[as] as ListElement;
  return (
    // exit as a target, not the "exit" label: any variant label makes the item
    // its own variant root, and it would then never take the list's hidden and
    // visible, so nothing would stagger or fade in
    <Comp
      variants={listItem}
      exit={listItem.exit as TargetAndTransition}
      layout={layout === false ? undefined : layout}
      transition={{ layout: spring }}
      {...props}
    />
  );
}
