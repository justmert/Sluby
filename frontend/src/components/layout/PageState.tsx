import type { ReactNode } from 'react';
import * as m from 'motion/react-m';
import type { LucideIcon } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { fadeUp, scaleIn } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface PageStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  /** Extra text under the description, e.g. an error message. */
  detail?: ReactNode;
  /** Buttons or links for the way out. */
  actions?: ReactNode;
  /** `error` tints the icon. */
  tone?: 'default' | 'error';
}

/**
 * A whole-page state with no page behind it: not found (the route or a
 * record), or a page that crashed. Vertically centred in the content area,
 * with the title as the page's h1. Shared so every such page looks the same.
 */
export function PageState({
  icon: Icon,
  title,
  description,
  detail,
  actions,
  tone = 'default',
}: PageStateProps) {
  return (
    <m.div variants={fadeUp} initial="hidden" animate="visible" className="flex min-h-[60vh]">
      <Empty>
        <EmptyHeader>
          <m.div variants={scaleIn}>
            <EmptyMedia variant="icon" className="size-10 rounded-xl">
              <Icon className={cn('size-5', tone === 'error' && 'text-destructive')} />
            </EmptyMedia>
          </m.div>
          <EmptyTitle role="heading" aria-level={1} className="text-base">
            {title}
          </EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
          {detail && (
            <EmptyDescription className="font-mono text-xs break-all">{detail}</EmptyDescription>
          )}
        </EmptyHeader>
        {actions && (
          <EmptyContent className="flex-row justify-center gap-2">{actions}</EmptyContent>
        )}
      </Empty>
    </m.div>
  );
}
