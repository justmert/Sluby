import { ExternalLink } from 'lucide-react';
import {
  EXPLORER_LABEL,
  EXTERNAL_LINK_PROPS,
  explorerUrls,
} from '@/lib/sia-explorer';
import { cn } from '@/lib/cn';

type EntityKind = 'host' | 'contract' | 'tx' | 'block' | 'address';

export interface ExplorerLinkProps {
  /** The on-chain identifier (host pubkey, contract id, tx id, block height / id, address). */
  value: string | number;
  /** The kind of entity the value refers to — determines which explorer route is used. */
  kind: EntityKind;
  /** Optional child override. If omitted we render a truncated hex representation of `value`. */
  children?: React.ReactNode;
  /** Show the external-link indicator icon (default: true). */
  showIcon?: boolean;
  /** Truncate to this many chars on each side when rendering a default label. */
  truncate?: number;
  className?: string;
  title?: string;
  /** Stop click propagation so the link can be nested inside an outer navigational element. */
  stopPropagation?: boolean;
}

function truncateMiddle(value: string, chars: number): string {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}\u2026${value.slice(-chars)}`;
}

function buildUrl(kind: EntityKind, value: string | number): string {
  switch (kind) {
    case 'host':
      return explorerUrls.host(String(value));
    case 'contract':
      return explorerUrls.contract(String(value));
    case 'tx':
      return explorerUrls.tx(String(value));
    case 'block':
      return explorerUrls.block(value);
    case 'address':
      return explorerUrls.address(String(value));
  }
}

/**
 * Renders an anchor that opens the Sia blockchain explorer for the given
 * entity. Always opens in a new tab with `rel="noopener noreferrer"`.
 *
 * Uses the same teal accent as other interactive links in the design.
 */
export function ExplorerLink({
  value,
  kind,
  children,
  showIcon = true,
  truncate = 8,
  className,
  title,
  stopPropagation = true,
}: ExplorerLinkProps) {
  const href = buildUrl(kind, value);
  const label =
    children ??
    (typeof value === 'number' ? String(value) : truncateMiddle(value, truncate));
  const tooltip = title ?? `Open on ${EXPLORER_LABEL}`;

  return (
    <a
      href={href}
      title={tooltip}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      className={cn(
        'inline-flex items-center gap-1 text-teal-400 hover:text-teal-300 transition-colors',
        className,
      )}
      {...EXTERNAL_LINK_PROPS}
    >
      <span className="font-mono truncate">{label}</span>
      {showIcon && <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />}
    </a>
  );
}
