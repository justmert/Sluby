import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { isTransferring, type QueuedUpload, type UploadState } from '@/lib/upload-store';
import { sentPercent, shortStatus, statusLine } from './upload-status';

function TrayRow({ upload: u }: { upload: UploadState }) {
  const bar = statusLine(u).bar;
  return (
    <li className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto" title={u.title}>
          {u.title}
        </p>
        <StatusBadge kind="upload" status={u.phase} className="shrink-0" />
      </div>
      <p className="truncate text-xs text-muted-foreground tabular-nums">{shortStatus(u)}</p>
      {typeof bar === 'number' && (
        <Progress
          value={isTransferring(u) ? sentPercent(u) : bar}
          smooth={u.phase === 'processing'}
          aria-label={`${u.title}, progress`}
        />
      )}
    </li>
  );
}

/**
 * The compact list behind the top bar's progress ring: what is uploading or
 * processing, what waits, and a way into the sheet for everything else.
 */
export function UploadTray({
  uploads,
  queued,
  onOpen,
}: {
  uploads: UploadState[];
  queued: QueuedUpload[];
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-col">
      <h2 id="upload-tray-title" className="font-heading text-heading">
        Uploads
      </h2>
      <ul className="-my-0.5 mt-1 flex max-h-80 flex-col divide-y overflow-y-auto">
        {uploads.map((u) => (
          <TrayRow key={u.key} upload={u} />
        ))}
      </ul>
      {queued.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {queued.length === 1 ? '1 more waits' : `${queued.length} more wait`} in the queue.
        </p>
      )}
      <Button variant="outline" size="sm" className="mt-3 self-end" onClick={onOpen}>
        Open uploads
      </Button>
    </div>
  );
}
