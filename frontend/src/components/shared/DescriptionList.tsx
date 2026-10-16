import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NO_VALUE } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CopyButton } from './CopyButton';

/**
 * Label and value rows: a video's details, an account, a probe. Labels are
 * muted on the left and values on the right; when the list is narrow (by its
 * own width) each value wraps under its label.
 *
 *   <DescriptionList>
 *     <DescriptionItem label="Video ID" mono copy={asset.id}>{asset.id}</DescriptionItem>
 *     <DescriptionItem label="Created">{formatDate(asset.createdAt)}</DescriptionItem>
 *     <DescriptionItem label="Duration" />            // shows an en dash
 *   </DescriptionList>
 */
export function DescriptionList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('@container/dl', className)}>
      <dl data-slot="description-list" className="divide-y text-sm">
        {children}
      </dl>
    </div>
  );
}

export interface DescriptionItemProps {
  label: ReactNode;
  /** the value; nothing (undefined, null, '') shows an en dash in muted text */
  children?: ReactNode;
  /** ids, hashes, URLs: monospace at 12px */
  mono?: boolean;
  /** adds a copy button that copies this text */
  copy?: string;
  /** the copy button's name when the label's case must stay, e.g. "Copy Sia indexer URL" */
  copyLabel?: string;
  /** a short explanation next to the label, in a tooltip */
  hint?: string;
  className?: string;
}

export function DescriptionItem({
  label,
  children,
  mono,
  copy,
  copyLabel,
  hint,
  className,
}: DescriptionItemProps) {
  const empty = children === undefined || children === null || children === '';
  return (
    <div
      data-slot="description-item"
      className={cn(
        'grid grid-cols-1 gap-1 py-2.5 first:pt-0 last:pb-0 @sm/dl:grid-cols-[minmax(7rem,2fr)_5fr] @sm/dl:gap-4',
        className,
      )}
    >
      <dt className="flex items-center gap-1 text-muted-foreground">
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`About ${typeof label === 'string' ? label : 'this'}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd
        className={cn(
          'flex min-w-0 items-center gap-1',
          mono && 'font-mono text-xs',
          empty && 'text-muted-foreground',
        )}
      >
        <span
          dir={mono ? undefined : 'auto'}
          className={cn('min-w-0', mono ? 'break-all' : 'wrap-anywhere')}
        >
          {empty ? NO_VALUE : children}
        </span>
        {copy && (
          <CopyButton
            value={copy}
            label={
              copyLabel ??
              `Copy ${typeof label === 'string' ? label.charAt(0).toLowerCase() + label.slice(1) : 'value'}`
            }
            className="-my-1 size-6 shrink-0"
          />
        )}
      </dd>
    </div>
  );
}
