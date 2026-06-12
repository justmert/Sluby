import { cn } from '@/lib/cn';
import { formatAddress } from '@/lib/formatters';
import { CopyButton } from './CopyButton';

export interface BlockchainLinkProps {
  address: string;
  type?: 'object' | 'address' | 'tx';
  network?: string;
  truncate?: boolean;
  showCopy?: boolean;
  className?: string;
}

export function BlockchainLink({
  address,
  truncate = true,
  showCopy = true,
  className,
}: BlockchainLinkProps) {
  const displayAddress = truncate ? formatAddress(address, 6) : address;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="font-mono text-xs text-zinc-300">{displayAddress}</span>
      {showCopy && <CopyButton value={address} />}
    </span>
  );
}
