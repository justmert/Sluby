import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { DeploymentStatus } from '@/hooks/useStats';
import { formatBytes } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { hostsLine, ratio } from './health';
import { Panel } from './parts';

const ROW = 'contents';

// "ed25519:60e8c6…2c5b": the scheme and enough of the key to tell it apart;
// the whole key is in the tooltip
const shortKey = (key: string) => (key.length > 21 ? `${key.slice(0, 14)}…${key.slice(-4)}` : key);
const DT = 'text-muted-foreground';
const DD = 'm-0 min-w-0 text-right wrap-anywhere';

/** The indexer account: how much is stored against the limit, the hosts, the app and its key. */
export function SiaAccountCard({ status }: { status?: DeploymentStatus }) {
  if (!status) return <SiaAccountLoading />;
  const { account, hosts } = status.indexer;
  const hostLine = hostsLine(hosts);
  return (
    <Panel id="health-sia-account" title="Sia account">
      {account ? (
        <div>
          <div className="mb-1.5 flex flex-wrap justify-between gap-x-4">
            <span className="text-muted-foreground">Stored</span>
            <span className="tabular-nums">
              <strong className="font-semibold">{formatBytes(account.pinned_data)}</strong> of{' '}
              {formatBytes(account.max_pinned_data)}
            </span>
          </div>
          <Progress
            smooth
            value={ratio(account.pinned_data, account.max_pinned_data)}
            aria-label="Sia storage used"
            className="h-2"
          />
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {formatBytes(account.pinned_size)} on Sia hosts, with redundancy
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">
          The Sia indexer did not answer, so the stored amount is unknown.
        </p>
      )}
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        {hostLine && (
          <div className={ROW}>
            <dt className={DT}>Hosts</dt>
            <dd className={DD}>{hostLine}</dd>
          </div>
        )}
        {account && (
          <>
            <div className={ROW}>
              <dt className={DT}>App</dt>
              <dd className={DD} dir="auto">
                {account.app_name}
              </dd>
            </div>
            <div className={ROW}>
              <dt className={DT}>Account key</dt>
              <dd className={cn(DD, 'font-mono text-xs leading-5')} title={account.account_key}>
                {shortKey(account.account_key)}
              </dd>
            </div>
          </>
        )}
      </dl>
    </Panel>
  );
}

export function SiaAccountLoading() {
  return (
    <Panel id="health-sia-account" title="Sia account">
      <div aria-hidden="true">
        <div className="mb-1.5 flex h-5.5 items-center justify-between">
          <Skeleton className={cn('h-3.5 w-14', lateReveal)} />
          <Skeleton className={cn('h-3.5 w-24', lateReveal)} />
        </div>
        <Skeleton className={cn('h-2 w-full rounded-full', lateReveal)} />
        <Skeleton className={cn('mt-2.5 h-3 w-48', lateReveal)} />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-2">
        {[44, 24, 36].map((w, i) => (
          <div key={i} className="flex h-5.5 items-center justify-between gap-4">
            <Skeleton className={cn('h-3.5 w-20', lateReveal)} />
            <Skeleton className={cn('h-3.5', lateReveal)} style={{ width: `${w * 4}px` }} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
