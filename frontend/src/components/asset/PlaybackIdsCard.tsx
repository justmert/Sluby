import { useEffect, useRef, useState } from 'react';
import { Code, KeyRound, Link2, Plus, Trash2 } from 'lucide-react';
import type { PlaybackId, PlaybackPolicy, VideoAsset } from '@sluby/sdk';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CopyButton } from '@/components/shared/CopyButton';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { InlineError } from '@/components/shared/InlineError';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  isPendingPlaybackId,
  playbackIdRowKey,
  playbackStreamUrl,
  signedPlaybackStreamUrl,
  useCreatePlaybackId,
  useDeletePlaybackId,
  usePlaybackIds,
} from '@/hooks/playback-id-queries';
import { primaryEmbed, needsSigning } from '@/lib/embed';
import { withLead } from '@/lib/errors';
import { formatDate } from '@/lib/formatters';
import { toastError, toastSuccess } from '@/lib/toast';

/** The backend refuses longer names (plan B-17). */
const NAME_MAX = 100;

type Asset = Pick<VideoAsset, 'id' | 'accessTier'>;

const POLICY_HELP: Record<PlaybackPolicy, string> = {
  public: 'Anyone who has the stream URL can play the video.',
  signed:
    "Players need a signed URL from your server. The video's files on Sia stay public unless the video itself is private.",
};

function CreateDialog({
  assetId,
  isPrivate,
  open,
  onOpenChange,
}: {
  assetId: string;
  /** a private video needs a signed URL whatever the ID's own rule says */
  isPrivate: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // whether this form is still on screen. a create that outlives it (closed,
  // or replaced by a new form) reports in a toast instead
  const shown = useRef(open);
  useEffect(() => {
    shown.current = open;
  }, [open]);
  useEffect(
    () => () => {
      shown.current = false;
    },
    [],
  );
  const create = useCreatePlaybackId(assetId, {
    onCreated: () => {
      if (shown.current) onOpenChange(false);
      toastSuccess('Playback ID created');
    },
    onFailed: (err, input) => {
      // in the form, with what was typed still in it
      if (shown.current) return;
      const lead = input.name
        ? `Could not create the playback ID “${input.name}”`
        : 'Could not create the playback ID';
      toastError(withLead(lead, err));
    },
  });
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<PlaybackPolicy>(isPrivate ? 'signed' : 'public');
  const help =
    isPrivate && policy === 'public'
      ? 'This video is private, so players still need a signed URL until you make it public.'
      : POLICY_HELP[policy];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    // the form waits for the answer, so what was typed is still there if it fails
    create.mutate({ policy, ...(name.trim() ? { name: name.trim() } : {}) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New playback ID</DialogTitle>
            <DialogDescription>
              Share or embed this video with an ID you can delete later without touching the video.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="playback-id-name">Name (optional)</FieldLabel>
              <Input
                id="playback-id-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Marketing site"
                maxLength={NAME_MAX}
                autoComplete="off"
                dir="auto"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="playback-id-policy">Who can play</FieldLabel>
              <Select value={policy} onValueChange={(v) => setPolicy(v as PlaybackPolicy)}>
                <SelectTrigger
                  id="playback-id-policy"
                  className="w-56 max-w-full"
                  aria-describedby="playback-id-policy-help"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Anyone with the URL</SelectItem>
                  <SelectItem value="signed">Signed URL required</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription id="playback-id-policy-help">{help}</FieldDescription>
            </Field>
          </FieldGroup>
          <InlineError error={create.error} title="Could not create the playback ID" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending}
              aria-busy={create.isPending || undefined}
            >
              {create.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mints a signed stream URL that plays for one hour and copies it. */
function CopySignedButton({ playbackId }: { playbackId: string }) {
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    setBusy(true);
    let signed: Awaited<ReturnType<typeof signedPlaybackStreamUrl>>;
    try {
      signed = await signedPlaybackStreamUrl(playbackId);
    } catch (err) {
      toastError(withLead('Could not create a signed URL', err));
      setBusy(false);
      return;
    }
    try {
      await navigator.clipboard.writeText(signed.url);
      const until = new Date(signed.expiresAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
      toastSuccess(`Signed URL copied. It works until ${until}`);
    } catch {
      // the url was made; only the browser refused the clipboard
      toastError(
        'Could not copy the signed URL. Allow this site to use the clipboard, then try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => void copy()}
      aria-label={`Copy signed URL for ${playbackId}, valid 1 hour`}
    >
      {busy ? <Spinner aria-hidden="true" role={undefined} aria-label={undefined} /> : <KeyRound />}
      Copy signed URL
    </Button>
  );
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess(done);
  } catch {
    toastError('Could not copy. Your browser blocked the clipboard');
  }
}

/**
 * The playback IDs of a ready video: create, copy and delete them, with the
 * New playback ID action at the top so its toast never covers it (FLW-33).
 */
export function PlaybackIdsCard({ asset }: { asset: Asset }) {
  const list = usePlaybackIds(asset.id);
  const remove = useDeletePlaybackId(asset.id);
  const [creating, setCreating] = useState(false);
  // a new key per opening gives the form fresh fields; it stays mounted while it closes
  const [createSeq, setCreateSeq] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<PlaybackId | null>(null);
  const rows = list.data;
  const anySigned = rows?.some((r) => needsSigning(asset, r)) ?? false;

  const openCreate = () => {
    setCreateSeq((n) => n + 1);
    setCreating(true);
  };

  const newButton = (
    <Button size="sm" onClick={openCreate}>
      <Plus />
      New playback ID
    </Button>
  );

  const columns: DataTableColumn<PlaybackId>[] = [
    {
      id: 'name',
      header: 'Name',
      primary: true,
      className: 'max-w-64 min-w-36 whitespace-normal',
      cell: (row) =>
        row.name ? (
          // long names wrap to two lines instead of pushing the buttons off screen (A11Y-08)
          <span dir="auto" className="line-clamp-2 wrap-anywhere" title={row.name}>
            {row.name}
          </span>
        ) : (
          <span className="font-normal text-muted-foreground">Untitled</span>
        ),
    },
    {
      id: 'id',
      header: 'Playback ID',
      cell: (row) =>
        isPendingPlaybackId(row) ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-3.5" aria-hidden="true" role={undefined} />
            Creating…
          </span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1">
            <code className="max-w-28 truncate font-mono text-xs @3xl/page:max-w-40">
              {row.playbackId}
            </code>
            <CopyButton
              value={row.playbackId}
              className="size-6"
              label={`Copy playback ID ${row.playbackId}`}
            />
          </span>
        ),
    },
    {
      id: 'access',
      header: 'Access',
      cell: (row) => <StatusBadge kind="policy" status={row.policy} />,
    },
    {
      id: 'url',
      header: 'Stream URL',
      cell: (row) => {
        if (isPendingPlaybackId(row)) return null;
        const url = playbackStreamUrl(row.playbackId);
        return (
          <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
            <span className="inline-flex min-w-0 items-center gap-1">
              <code
                className="max-w-32 truncate font-mono text-xs text-muted-foreground @3xl/page:max-w-48"
                title={url}
              >
                {url.replace(/^https?:\/\//, '')}
              </code>
              <CopyButton
                value={url}
                className="size-6"
                label={`Copy stream URL for ${row.playbackId}`}
              />
            </span>
            {needsSigning(asset, row) && <CopySignedButton playbackId={row.playbackId} />}
          </span>
        );
      },
    },
    {
      id: 'created',
      header: 'Created',
      // gives way first on narrow pages so the row menu stays on screen (A11Y-08)
      className: 'hidden text-muted-foreground @3xl/page:table-cell',
      cell: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <section aria-label="Playback IDs" className="flex flex-col gap-3">
      <DataTable
        caption="Playback IDs"
        rows={rows}
        loadingRows={2}
        getRowId={(r) => r.id}
        getRowKey={playbackIdRowKey}
        getRowLabel={(r) => r.name || r.playbackId || 'new playback ID'}
        animateRows
        columns={columns}
        rowClassName={(r) => (isPendingPlaybackId(r) ? 'opacity-60' : undefined)}
        rowActions={(row) =>
          isPendingPlaybackId(row)
            ? []
            : [
                {
                  label: 'Copy embed code',
                  icon: Code,
                  onSelect: () =>
                    void copyText(primaryEmbed(asset, { by: row }).code, 'Embed code copied'),
                },
                {
                  label: 'Copy stream URL',
                  icon: Link2,
                  onSelect: () =>
                    void copyText(playbackStreamUrl(row.playbackId), 'Stream URL copied'),
                },
                {
                  label: 'Delete',
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => setPendingDelete(row),
                },
              ]
        }
        toolbar={
          <>
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              IDs for sharing and embedding. Deleting one stops every player that uses it.
            </p>
            {rows && rows.length > 0 && newButton}
          </>
        }
        error={list.error}
        onRetry={list.refetch}
        retrying={list.isFetching}
        what="playback IDs"
        empty={
          <EmptyState
            icon={Link2}
            title="No playback IDs yet"
            description="Players can use the video ID, or create a playback ID you can delete on its own."
            action={newButton}
          />
        }
      />
      {anySigned && (
        <p className="text-xs text-muted-foreground">
          Players need a signed URL for{' '}
          {asset.accessTier === 'private' ? 'this private video' : 'these IDs'}. Your server gets
          one from <code className="font-mono">GET /api/v1/playback/:id/signed</code>. Copy signed
          URL gives you one that works for 1 hour.
        </p>
      )}

      <CreateDialog
        key={createSeq}
        assetId={asset.id}
        isPrivate={asset.accessTier === 'private'}
        open={creating}
        onOpenChange={setCreating}
      />

      <ConfirmDialog
        item={pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete this playback ID?"
        description={(row) => (
          <>
            New plays with <code className="font-mono">{row.playbackId}</code> stop working at once;
            a player already playing it keeps going until it reloads. The video and its other
            playback IDs are not affected. This cannot be undone.
          </>
        )}
        confirmLabel="Delete"
        onConfirm={(row) => {
          // the row leaves at once and comes back if the server says no
          remove.mutate(row.playbackId, {
            onSuccess: () => toastSuccess('Playback ID deleted'),
            onError: (err) => toastError(withLead('Could not delete the playback ID', err)),
          });
        }}
      />
    </section>
  );
}
