import { StatusBadge } from '@/components/shared/StatusBadge';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import type { Probe, SystemStatus } from '@/hooks/useStats';
import { formatUptime } from '@/lib/formatters';
import { probeHealth, probeText } from './health';
import { HealthCard, RowsLoading } from './parts';

const SERVICES: { key: 'indexer' | 'database' | 'redis'; label: string; about?: string }[] = [
  {
    key: 'indexer',
    label: 'Sia indexer',
    about: 'The service that tracks where your files live on Sia',
  },
  { key: 'database', label: 'Database' },
  { key: 'redis', label: 'Job queue', about: 'Runs transcoding and storing on Sia' },
];

function ServiceRow({ label, about, probe }: { label: string; about?: string; probe: Probe }) {
  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {about && <p className="text-xs text-muted-foreground">{about}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {probe.ok && (
            <span className="text-sm text-muted-foreground tabular-nums">{probeText(probe)}</span>
          )}
          <StatusBadge kind="health" status={probeHealth(probe)}>
            {probe.ok ? undefined : probeText(probe)}
          </StatusBadge>
        </div>
      </div>
      {/* the raw error can be a long tls or socket line; it reads under Details, never as the headline */}
      {!probe.ok && <ErrorDetails detail={probe.error} />}
    </li>
  );
}

/** The three probes and the backend version: the first card on Health. */
export function ServicesCard({ status }: { status?: SystemStatus }) {
  const deployment = status?.scope === 'deployment' ? status : undefined;
  return (
    <HealthCard title="Services" description="What this server needs to store and stream video">
      {!status ? (
        <>
          <RowsLoading
            count={3}
            className="[&>div]:h-14 [&>div:first-child]:h-11.5 [&>div:last-child]:h-11.5"
          />
          <div aria-hidden="true" className="mt-4 h-9 border-t" />
        </>
      ) : (
        <>
          <ul aria-label="Services" className="flex flex-col divide-y">
            {SERVICES.map((s) => (
              <ServiceRow key={s.key} label={s.label} about={s.about} probe={status[s.key]} />
            ))}
          </ul>
          <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">
            Backend <span className="text-foreground tabular-nums">v{status.version}</span>
            {deployment && `, running for ${formatUptime(deployment.uptime_seconds * 1000)}`}
          </p>
        </>
      )}
    </HealthCard>
  );
}
