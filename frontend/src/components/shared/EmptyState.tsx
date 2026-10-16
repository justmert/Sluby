import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon: LucideIcon;
  /** 30 characters at most: "No API keys yet" */
  title: string;
  /** one sentence, 90 characters at most, ending with a period */
  description?: ReactNode;
  /** the one thing to do next, usually a primary button */
  action?: ReactNode;
  /** a quieter second way forward, such as a link button */
  secondaryAction?: ReactNode;
  /** `card` (default) fits a card body or a table; `section` adds a dashed frame for an empty page area */
  variant?: 'card' | 'section';
  className?: string;
}

/**
 * What a list, table or card shows when there is nothing in it yet: an icon,
 * a short title, one sentence, and the action that fills it.
 *
 *   <EmptyState icon={KeyRound} title="No API keys yet"
 *     description="Create a key to use the API or SDK from your server."
 *     action={<Button onClick={openCreate}><Plus />Create key</Button>} />
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'card',
  className,
}: EmptyStateProps) {
  return (
    <Empty
      data-slot="empty-state"
      className={cn(
        'gap-3 py-8',
        variant === 'section' && 'border border-dashed bg-muted/20 py-12',
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {(action || secondaryAction) && (
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          {secondaryAction}
          {action}
        </EmptyContent>
      )}
    </Empty>
  );
}
