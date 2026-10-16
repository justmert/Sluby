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
  /** `card` (default) fits a card body or a table; `section` puts it in its own card, for an empty page area */
  variant?: 'card' | 'section';
  /**
   * `error` is the board's "Could not load" card: the icon tile takes the
   * danger colour and edge, and the block is an alert. Use it for a list or
   * card that failed as a whole; InlineError is the smaller one-row note.
   */
  tone?: 'default' | 'error';
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
  tone = 'default',
  className,
}: EmptyStateProps) {
  return (
    <Empty
      data-slot="empty-state"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(variant === 'section' && 'border bg-card', className)}
    >
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className={cn(tone === 'error' && 'border-destructive-line text-destructive')}
        >
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {(action || secondaryAction) && (
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          {/* the design leads with the primary action */}
          {action}
          {secondaryAction}
        </EmptyContent>
      )}
    </Empty>
  );
}
