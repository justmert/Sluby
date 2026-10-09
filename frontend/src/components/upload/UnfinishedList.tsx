import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { errorStatus } from '@/hooks/asset-queries';
import { formatBytes, formatRelativeTime } from '@/lib/formatters';
import { sluby } from '@/lib/sluby';
import { toastSuccess } from '@/lib/toast';
import { forgetUnfinishedUpload, type UnfinishedUpload } from '@/lib/unfinished-uploads';
import { sentOf } from './upload-status';

/** Why a picked file cannot continue this upload, or null when it can. */
export type ResumeResult = string | null;

function UnfinishedRow({
  upload,
  onChoose,
  onDelete,
}: {
  upload: UnfinishedUpload;
  onChoose: (file: File) => Promise<ResumeResult>;
  onDelete: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const name = upload.title || upload.fileName;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={name} dir="auto">
            {name}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            <span dir="auto">{upload.fileName}</span>, {sentOf(upload.offset, upload.size)}
            {upload.createdAt && `, started ${formatRelativeTime(upload.createdAt)}`}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onDelete} disabled={checking}>
            Delete
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={checking}
            onClick={() => input.current?.click()}
          >
            Choose file
          </Button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="video/*,.mkv,.avi,.m4v"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={`resume-input-${upload.uploadId}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setChecking(true);
          void onChoose(file)
            .then(setProblem)
            .finally(() => setChecking(false));
        }}
      />
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </li>
  );
}

/**
 * Uploads an earlier page load left partway, from what tus keeps in this
 * browser. Adding the same file continues one; Delete removes the partial
 * file and its video entry after a confirm (FLW-48).
 */
export function UnfinishedList({
  rows,
  onChoose,
}: {
  rows: UnfinishedUpload[];
  onChoose: (upload: UnfinishedUpload, file: File) => Promise<ResumeResult>;
}) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<UnfinishedUpload | null>(null);

  if (rows.length === 0) return null;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((u) => (
          <UnfinishedRow
            key={u.storageKey}
            upload={u}
            onChoose={(file) => onChoose(u, file)}
            onDelete={() => setDeleting(u)}
          />
        ))}
      </ul>
      <ConfirmDialog
        item={deleting}
        onClose={() => setDeleting(null)}
        title="Delete this unfinished upload?"
        description={(u) =>
          `The ${formatBytes(u.offset)} already sent and the video entry are deleted. This cannot be undone.`
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        errorTitle="Could not delete the unfinished upload"
        onConfirm={async (u) => {
          try {
            // removes the partial file and the video entry it created
            await sluby.uploads.cancel(u.uploadId);
          } catch (err) {
            // gone already, or finished after all: either way nothing is left to delete
            if (errorStatus(err) !== 404 && errorStatus(err) !== 409) throw err;
          }
          forgetUnfinishedUpload(u.storageKey);
          toastSuccess(`“${u.title || u.fileName}” deleted`);
          void queryClient.invalidateQueries({ queryKey: ['uploads', 'unfinished'] });
          void queryClient.invalidateQueries({ queryKey: ['assets'] });
        }}
      />
    </>
  );
}
