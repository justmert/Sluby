import type { ReactNode } from 'react';
import { StatusTransition } from '@/components/motion/StatusTransition';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  httpSpec,
  statusSpec,
  STATUS,
  type StatusKind,
  type StatusOf,
  type StatusSpec,
  type StatusTone,
} from './status';

const VARIANT = {
  neutral: 'secondary',
  progress: 'progress',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
  info: 'info',
  outline: 'outline',
} as const satisfies Record<StatusTone, string>;

interface BadgeViewProps {
  spec: StatusSpec;
  /**
   * How a busy status shows that work goes on. `dot` (the default) is a calm
   * pulsing dot for rows of a list; `spinner` is for the one status a page is
   * about, such as the video page header.
   */
  busy?: 'dot' | 'spinner';
  /** replaces the label, e.g. "Expires in 2 hours" for an expiring key */
  children?: ReactNode;
  className?: string;
  title?: string;
}

function BadgeView({ spec, busy = 'dot', children, className, title }: BadgeViewProps) {
  const Icon = spec.icon;
  return (
    <Badge variant={VARIANT[spec.tone]} className={className} title={title} data-tone={spec.tone}>
      {spec.busy ? (
        busy === 'spinner' ? (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        ) : (
          <span
            data-slot="status-dot"
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-status-pulse"
          />
        )
      ) : (
        Icon && <Icon data-icon="inline-start" aria-hidden="true" />
      )}
      {children ?? spec.label}
    </Badge>
  );
}

export interface StatusBadgeProps<K extends StatusKind> extends Omit<BadgeViewProps, 'spec'> {
  /** which kind of thing the status belongs to; see STATUS in status.ts */
  kind: K;
  status: StatusOf<K> | (string & {});
  /** announce changes politely; give it to one badge per page, not every row */
  live?: boolean;
}

/**
 * A status as a badge, with the label, tone and icon from the one mapping in
 * status.ts. A change of status crossfades the badge.
 *
 *   <StatusBadge kind="asset" status={asset.status} />
 *   <StatusBadge kind="asset" status={asset.status} busy="spinner" live />
 *   <StatusBadge kind="key" status="replaced">Replaced · Stops {formatTimeLeft(at)}</StatusBadge>
 */
export function StatusBadge<K extends StatusKind>({
  kind,
  status,
  live = false,
  ...view
}: StatusBadgeProps<K>) {
  return (
    <StatusTransition status={String(status)} live={live}>
      <BadgeView spec={statusSpec(kind, status)} {...view} />
    </StatusTransition>
  );
}

/** The answer code of an http request: 2xx green, 4xx amber, 5xx or none red. */
export function HttpStatusBadge({
  code,
  className,
}: {
  code: number | null | undefined;
  className?: string;
}) {
  return (
    <BadgeView
      spec={httpSpec(code)}
      className={cn('font-mono tabular-nums', code == null && 'font-sans', className)}
    />
  );
}

/**
 * Who can watch a video: nothing for public (the default needs no badge), an
 * outline Private badge with a lock otherwise. The same look everywhere a
 * video's access shows: grid, list, header, palette.
 */
export function AccessBadge({
  access,
  className,
}: {
  access: 'public' | 'private';
  className?: string;
}) {
  if (access !== 'private') return null;
  return <BadgeView spec={STATUS.access.private} className={className} />;
}
