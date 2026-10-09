import { useRef, useState, type ReactNode } from 'react';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { withCells } from '@/components/shared/column-frames';
import { EmptyState } from '@/components/shared/EmptyState';
import { InlineEditField } from '@/components/shared/InlineEditField';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  isReplaced,
  useApiKeys,
  useRenameApiKey,
  useRevokeApiKey,
  type ApiKeyRecord,
  type IssuedKey,
} from '@/hooks/useApiKeys';
import { usePersistedDraft } from '@/lib/drafts';
import {
  NO_VALUE,
  formatCount,
  formatDate,
  formatRelativeTime,
  formatTimeLeft,
} from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { toastSuccess } from '@/lib/toast';
import { KEY_COLUMNS } from './columns';
import { useCreateParam } from './create-param';
import { CreateKeyDialog } from './CreateKeyDialog';
import { emptyKeyForm, KEY_NAME_MAX, type KeyForm } from './forms';
import { keyLabel } from './key-label';
import { RotateKeyDialog } from './RotateKeyDialog';
import { focusRowMenu, focusTargets, rowFocus, startRowEdit, type RowFocus } from './row-focus';
import { SecretRevealDialog, type RevealedSecret } from './SecretRevealDialog';

const TABLE = 'API keys';
const CREATE_BUTTON_ID = 'create-key-button';
const CAP_REASON_ID = 'key-cap-reason';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function revealedKey(issued: IssuedKey, graceSeconds?: number): RevealedSecret {
  const rotated = issued.rotatedFrom !== undefined;
  let note: ReactNode;
  if (rotated) {
    note =
      graceSeconds === 0 || !issued.previousKeyExpiresAt
        ? 'The old key stops working now.'
        : `The old key keeps working until ${formatDate(issued.previousKeyExpiresAt)} at ${time(issued.previousKeyExpiresAt)}.`;
  }
  return {
    title: rotated ? 'API key rotated' : 'API key created',
    description: <>Copy “{issued.name}” now. You will not be able to see it again.</>,
    value: issued.key,
    label: 'API key',
    envName: 'SLUBY_API_KEY',
    note,
  };
}

const rowLabel = (k: ApiKeyRecord) => (k.prefix ? `${k.name}, ${k.prefix}…` : k.name);

/** Every API key of the account: create, rename, rotate and revoke. */
export function ApiKeysManager() {
  const keys = useApiKeys();
  const rename = useRenameApiKey();
  const revoke = useRevokeApiKey();
  const rows = keys.data?.data;
  const limits = keys.data?.limits;
  const atCap = limits !== undefined && rows !== undefined && rows.length >= limits.maxKeys;

  const [creating, setCreating] = useCreateParam('key');
  const [form, setForm] = useState<KeyForm>(emptyKeyForm);
  usePersistedDraft('create-key', creating ? form : null, (draft) => {
    setForm(draft);
    setCreating(true);
  });

  const [rotating, setRotating] = useState<ApiKeyRecord | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRecord | null>(null);
  // where focus goes when a row's dialog closes; a ref, since the dialog
  // state is already cleared by then
  const focusAfter = useRef<RowFocus | null>(null);
  // the secret on show, and the key row to focus once it is copied
  const [revealed, setRevealed] = useState<{ secret: RevealedSecret; rowId?: string } | null>(null);

  const openCreate = () => {
    if (atCap) return;
    setForm(emptyKeyForm());
    setCreating(true);
  };

  const columns = withCells<ApiKeyRecord>(KEY_COLUMNS, {
    name: (k) => (
      <InlineEditField
        label={`name of ${k.name}`}
        className="w-full min-w-40"
        value={k.name}
        maxLength={KEY_NAME_MAX}
        requiredMessage="Enter a name."
        displayClassName="whitespace-normal wrap-anywhere"
        onSave={async (name) => {
          await rename.mutateAsync({ id: k.id, name });
          toastSuccess('Key renamed');
        }}
      />
    ),
    key: (k) =>
      k.prefix ? (
        <span className="font-mono text-xs">{k.prefix}…</span>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="rounded-sm text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              aria-label="Not recorded. Created before key prefixes were recorded"
            >
              {NO_VALUE}
            </span>
          </TooltipTrigger>
          <TooltipContent>Created before key prefixes were recorded</TooltipContent>
        </Tooltip>
      ),
    scopes: (k) => (
      <span className="flex flex-wrap gap-1">
        {k.scopes.map((s) => (
          <Badge key={s} variant="code">
            {s}
          </Badge>
        ))}
      </span>
    ),
    'last-used': (k) =>
      k.lastUsedAt === null ? (
        <span className="text-muted-foreground">Never</span>
      ) : (
        <time dateTime={k.lastUsedAt} title={formatDate(k.lastUsedAt)}>
          {formatRelativeTime(k.lastUsedAt)}
        </time>
      ),
    created: (k) => <time dateTime={k.createdAt}>{formatDate(k.createdAt)}</time>,
    status: (k) =>
      isReplaced(k) ? (
        <StatusBadge kind="key" status="replaced">
          Replaced · Stops {formatTimeLeft(k.expiresAt!)}
        </StatusBadge>
      ) : (
        <StatusBadge kind="key" status="active" />
      ),
  });

  const createButton = (
    <Button
      id={CREATE_BUTTON_ID}
      onClick={openCreate}
      aria-disabled={atCap || undefined}
      aria-describedby={atCap ? CAP_REASON_ID : undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    >
      <Plus />
      Create key
    </Button>
  );
  const capReason = limits
    ? `You have ${formatCount(limits.maxKeys)} keys, the most allowed. Revoke one to create another.`
    : '';
  const primary = atCap ? (
    <Tooltip>
      <TooltipTrigger asChild>{createButton}</TooltipTrigger>
      <TooltipContent className="max-w-64">{capReason}</TooltipContent>
    </Tooltip>
  ) : (
    createButton
  );

  const table = (
    <div className="flex flex-col gap-3">
      <DataTable
        caption={TABLE}
        rows={rows}
        columns={columns}
        getRowId={(k) => k.id}
        getRowLabel={rowLabel}
        animateRows
        loadingRows={3}
        error={keys.error}
        onRetry={() => keys.refetch()}
        retrying={keys.isFetching}
        what="your API keys"
        rowActions={(k) => [
          {
            label: 'Rename',
            icon: Pencil,
            onSelect: () => startRowEdit(TABLE, k.id),
          },
          ...(isReplaced(k)
            ? []
            : [
                {
                  label: 'Rotate',
                  icon: Icons.rotate,
                  onSelect: () => {
                    focusAfter.current = rowFocus(rows, k, (r) => r.id);
                    setRotating(k);
                  },
                },
              ]),
          {
            label: 'Revoke',
            icon: Icons.delete,
            destructive: true,
            onSelect: () => {
              focusAfter.current = rowFocus(rows, k, (r) => r.id);
              setRevoking(k);
            },
          },
        ]}
        empty={
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            description="Create a key to use the API or SDK from your server."
            action={
              <Button onClick={openCreate}>
                <Plus />
                Create key
              </Button>
            }
          />
        }
      />
      {limits && rows && rows.length > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatCount(rows.length)} of {formatCount(limits.maxKeys)} keys
        </p>
      )}
      {atCap && (
        <p id={CAP_REASON_ID} className="text-sm text-muted-foreground">
          {capReason}
        </p>
      )}
    </div>
  );

  const dialogs = (
    <>
      <CreateKeyDialog
        open={creating}
        onOpenChange={setCreating}
        form={form}
        onFormChange={setForm}
        limits={limits}
        onIssued={(issued) => setRevealed({ secret: revealedKey(issued) })}
      />
      <RotateKeyDialog
        target={rotating}
        onClose={() => setRotating(null)}
        onIssued={(issued, grace) =>
          setRevealed({ secret: revealedKey(issued, grace), rowId: issued.id })
        }
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const f = focusAfter.current;
          focusRowMenu(TABLE, f ? [f.own, f.next, f.prev] : [], () =>
            document.getElementById(CREATE_BUTTON_ID),
          );
        }}
      />
      <SecretRevealDialog
        secret={revealed?.secret ?? null}
        onClose={() => setRevealed(null)}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          // a rotated key goes back to its new row; a created one to Create key
          focusRowMenu(TABLE, [revealed?.rowId], () => document.getElementById(CREATE_BUTTON_ID));
        }}
      />
      <ConfirmDialog
        item={revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this key?"
        description={(k) => (
          <>
            {keyLabel(k)} stops working right away. This cannot be undone.
            {isReplaced(k) && (
              <>
                {' '}
                It is the old key from a rotation and stops on its own{' '}
                {formatTimeLeft(k.expiresAt!)}.
              </>
            )}
          </>
        )}
        confirmLabel="Revoke"
        pendingLabel="Revoking…"
        errorTitle="Could not revoke the key"
        onConfirm={async (k) => {
          await revoke.mutateAsync(k.id);
          if (focusAfter.current) focusAfter.current.gone = true;
          toastSuccess(`“${k.name}” revoked`);
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const f = focusAfter.current;
          focusRowMenu(TABLE, f ? focusTargets(f) : [], () =>
            document.getElementById(CREATE_BUTTON_ID),
          );
        }}
      />
    </>
  );

  return (
    <>
      <PageHeader
        title="API keys"
        description="For the REST API and SDK, shown once when created"
        primaryAction={primary}
      />
      {table}
      {dialogs}
    </>
  );
}
