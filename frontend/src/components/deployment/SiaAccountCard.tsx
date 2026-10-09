import { DescriptionItem, DescriptionList } from '@/components/shared/DescriptionList';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { DeploymentStatus } from '@/hooks/useStats';
import { formatBytes } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { hostsLine, ratio } from './health';
import { HealthCard, RowsLoading } from './parts';

const TITLE = 'Sia account';
const DESCRIPTION = "What this server's Sia account holds";

/** The indexer account: how much is stored against the limit, the hosts, the network. */
export function SiaAccountCard({ status }: { status?: DeploymentStatus }) {
  if (!status) {
    return (
      <HealthCard title={TITLE} description={DESCRIPTION}>
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className={cn('h-7 w-40', lateReveal)} />
          <Skeleton className={cn('h-1 w-full', lateReveal)} />
        </div>
        <RowsLoading count={4} className="mt-4" />
      </HealthCard>
    );
  }
  const { account, hosts, network, url } = status.indexer;
  return (
    <HealthCard title={TITLE} description={DESCRIPTION}>
      {account ? (
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-heading text-figure-sm tabular-nums">
              {formatBytes(account.pinned_data)}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              of {formatBytes(account.max_pinned_data)} used
            </span>
          </p>
          <Progress
            smooth
            value={ratio(account.pinned_data, account.max_pinned_data)}
            aria-label="Sia storage used"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sia storage is unavailable because the Sia indexer did not respond.
        </p>
      )}
      <DescriptionList className="mt-4">
        {account && (
          <DescriptionItem label="On Sia hosts">
            {formatBytes(account.pinned_size)}, with redundancy
          </DescriptionItem>
        )}
        <DescriptionItem label="Hosts">{hostsLine(hosts)}</DescriptionItem>
        <DescriptionItem label="Sia account">
          {account ? (account.ready ? 'Ready' : 'Not ready yet') : null}
        </DescriptionItem>
        <DescriptionItem label="Network">{network}</DescriptionItem>
        <DescriptionItem label="Sia indexer" mono copy={url}>
          {url}
        </DescriptionItem>
      </DescriptionList>
    </HealthCard>
  );
}
