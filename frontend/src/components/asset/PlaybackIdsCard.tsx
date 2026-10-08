import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PlaybackId, PlaybackPolicy } from '@sluby/sdk';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { CopyButton } from '@/components/shared/CopyButton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { ResponsiveCell, ResponsiveTable } from '@/components/ui/responsive-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFrozen } from '@/hooks/useFrozen';
import {
  isPendingPlaybackId,
  playbackIdRowKey,
  playbackStreamUrl,
  useCreatePlaybackId,
  useDeletePlaybackId,
  usePlaybackIds,
} from '@/hooks/playback-id-queries';
import { formatDate } from '@/lib/formatters';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function CreateDialog({
  assetId,
  open,
  onOpenChange,
}: {
  assetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreatePlaybackId(assetId);
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<PlaybackPolicy>('public');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = { policy, ...(name.trim() ? { name: name.trim() } : {}) };
    // the row shows at once as pending; the dialog does not wait for it
    onOpenChange(false);
    create.mutate(input, {
      onSuccess: (row) => toast.success(`Playback ID ${row.playbackId} created`),
      onError: (err) => toast.error(`Could not create the playback ID: ${errorText(err)}`),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // a fresh form each time it opens
        if (o) {
          setName('');
          setPolicy('public');
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New playback ID</DialogTitle>
            <DialogDescription>
              A playback ID is a public handle for this video. Embed it instead of the asset ID, and
              delete it to cut off every player that uses it.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="playback-id-name">Name (optional)</FieldLabel>
              <Input
                id="playback-id-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Marketing site embed"
                maxLength={200}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="playback-id-policy">Policy</FieldLabel>
              <Select value={policy} onValueChange={(v) => setPolicy(v as PlaybackPolicy)}>
                <SelectTrigger id="playback-id-policy" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="signed">Signed</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                {policy === 'public'
                  ? 'Anyone with the stream URL can play it.'
                  : 'The stream URL needs a signature from a signed playback URL. This gates the URL only; make the asset private to protect its bytes.'}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyBadge({ policy }: { policy: PlaybackPolicy }) {
  return policy === 'signed' ? (
    <Badge variant="warning">Signed</Badge>
  ) : (
    <Badge variant="secondary">Public</Badge>
  );
}

function Row({ row, onDelete }: { row: PlaybackId; onDelete: () => void }) {
  const pending = isPendingPlaybackId(row);
  const url = pending ? '' : playbackStreamUrl(row.playbackId);
  return (
    <AnimatedItem
      as="tr"
      data-slot="table-row"
      data-pending={pending || undefined}
      className="border-b transition-colors hover:bg-muted/50 data-pending:opacity-60"
    >
      <ResponsiveCell cell="primary" className="pl-4">
        {row.name || <span className="text-muted-foreground">Untitled</span>}
      </ResponsiveCell>
      <ResponsiveCell label="ID">
        {pending ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-3.5" aria-hidden="true" />
            Creating...
          </span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1">
            <code className="truncate font-mono text-xs">{row.playbackId}</code>
            <CopyButton
              value={row.playbackId}
              className="size-6"
              label={`Copy playback ID ${row.playbackId}`}
            />
          </span>
        )}
      </ResponsiveCell>
      <ResponsiveCell label="Policy">
        <PolicyBadge policy={row.policy} />
      </ResponsiveCell>
      <ResponsiveCell label="Stream URL">
        {!pending && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <code className="max-w-56 truncate font-mono text-xs text-muted-foreground" title={url}>
              {url.replace(/^https?:\/\//, '')}
            </code>
            <CopyButton
              value={url}
              className="size-6"
              label={`Copy stream URL of ${row.playbackId}`}
            />
          </span>
        )}
      </ResponsiveCell>
      <ResponsiveCell label="Created" className="text-muted-foreground">
        {formatDate(row.createdAt)}
      </ResponsiveCell>
      <ResponsiveCell cell="actions" className="pr-4 text-right">
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-coarse:size-10"
          disabled={pending}
          onClick={onDelete}
          aria-label={pending ? 'Delete playback ID' : `Delete playback ID ${row.playbackId}`}
        >
          <Trash2 />
        </Button>
      </ResponsiveCell>
    </AnimatedItem>
  );
}

/** List, create, copy and delete the playback IDs of a ready asset. */
export function PlaybackIdsCard({ assetId }: { assetId: string }) {
  const list = usePlaybackIds(assetId);
  const remove = useDeletePlaybackId(assetId);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PlaybackId | null>(null);
  const deleteOpen = pendingDelete !== null;
  const shown = useFrozen(pendingDelete, deleteOpen);
  const rows = list.data ?? [];
  const hasSigned = rows.some((r) => r.policy === 'signed');

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const { playbackId } = pendingDelete;
    setPendingDelete(null);
    remove.mutate(playbackId, {
      onSuccess: () => toast.success(`Playback ID ${playbackId} deleted`),
      onError: (err) => toast.error(`Could not delete ${playbackId}: ${errorText(err)}`),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Playback IDs</CardTitle>
        <CardDescription>
          Public handles for embedding this video. Players load the stream URL; deleting an ID stops
          every player that uses it.
        </CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New playback ID
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {list.isLoading ? (
          <div className="flex flex-col gap-2 px-4" data-testid="playback-ids-skeleton">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : list.isError ? (
          <div className="flex flex-col items-start gap-2 px-4 text-sm">
            <p className="text-destructive">Could not load playback IDs: {list.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">
            No playback IDs yet. Players can still use the asset ID; create one to share a handle
            you can revoke on its own.
          </p>
        ) : (
          <ResponsiveTable className="max-sm:px-4">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Stream URL</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <AnimatedList as="tbody" data-slot="table-body" className="[&_tr:last-child]:border-0">
              {rows.map((row) => (
                <Row key={playbackIdRowKey(row)} row={row} onDelete={() => setPendingDelete(row)} />
              ))}
            </AnimatedList>
          </ResponsiveTable>
        )}
        {hasSigned && (
          <p className="mt-3 px-4 text-xs text-muted-foreground">
            A signed ID&apos;s stream URL needs the <code>expires</code> and <code>sig</code> of a
            signed playback URL from <code>GET /api/v1/playback/:id/signed</code>.
          </p>
        )}
      </CardContent>

      <CreateDialog assetId={assetId} open={creating} onOpenChange={setCreating} />

      <AlertDialog open={deleteOpen} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete playback ID {shown?.playbackId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Players using it stop working at once. The video and its other playback IDs are not
              affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
