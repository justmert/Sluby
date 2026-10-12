import { useRef, useState } from 'react';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { withCells } from '@/components/shared/column-frames';
import { EmptyState } from '@/components/shared/EmptyState';
import { InlineEditField } from '@/components/shared/InlineEditField';
import { StatusBadge } from '@/components/shared/StatusBadge';
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
import { keyCopyButton, keyLabel } from './key-label';
import { RotateKeyDialog } from './RotateKeyDialog';
import { focusRowMenu, focusTargets, rowFocus, startRowEdit, type RowFocus } from './row-focus';
import { KeyCreatedNotice, type CreatedKey } from './KeyCreatedNotice';
import { KEY_SCOPES } from './options';
import { CreateKeyButton } from '@/components/layout/page-actions';
import { PAGE_HEADS } from '@/components/layout/page-heads';

const TABLE = 'API keys';
const CREATE_BUTTON_ID = 'create-key-button';
const CAP_REASON_ID = 'key-cap-reason';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function createdKey(issued: IssuedKey, graceSeconds?: number): CreatedKey {
  const rotated = issued.rotatedFrom !== undefined;
  let note: string | undefined;
  if (rotated) {
    note =
      graceSeconds === 0 || !issued.previousKeyExpiresAt
        ? 'The old key stopped working.'
        : `The old key keeps working until ${formatDate(issued.previousKeyExpiresAt)} at ${time(issued.previousKeyExpiresAt)}.`;
  }
  return { id: issued.id, name: issued.name, value: issued.key, rotated, note };
}

// what a scope lets a key do, as the table's Can column says it
const SCOPE_ORDER = ['read', 'upload', 'manage'];
const scopeName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sortedScopes = (scopes: string[]) =>
  [...scopes].sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b));
const scopeDetail = (s: string) => KEY_SCOPES.find((o) => o.value === s)?.detail;

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
  // keys just issued, each shown until it is copied or dismissed; a rotated
  // one remembers its row, where focus goes once it is dismissed
  const [created, setCreated] = useState<Array<CreatedKey & { rowId?: string }>>([]);
  // the key a dialog just issued: as that dialog closes, focus goes to the
  // key's copy button instead of back to the opener, since copying is next
  const issuedNow = useRef<string | null>(null);
  const show = (key: CreatedKey, rowId?: string) => {
    issuedNow.current = key.id;
    setCreated((list) => [{ ...key, rowId }, ...list.filter((c) => c.id !== key.id)]);
  };
  /** true when focus went to a new key, so the dialog leaves it there */
  const focusIssued = (e: Event) => {
    const id = issuedNow.current;
    issuedNow.current = null;
    const button = id ? keyCopyButton(id) : null;
    if (!button) return false;
    e.preventDefault();
    button.focus();
    return true;
  };
  const dismiss = (id: string) => {
    const gone = created.find((c) => c.id === id);
    setCreated((list) => list.filter((c) => c.id !== id));
    // a rotated key goes back to its new row; a created one to Create key
    requestAnimationFrame(() =>
      focusRowMenu(TABLE, [gone?.rowId], () => document.getElementById(CREATE_BUTTON_ID)),
    );
  };

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
        {sortedScopes(k.scopes).map((s) => (
          <span
            key={s}
            title={scopeDetail(s)}
            className="inline-flex h-5.5 items-center rounded-md border bg-card px-2 text-xs font-medium text-secondary-foreground"
          >
            {scopeName(s)}
          </span>
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
          Replaced · stops {formatTimeLeft(k.expiresAt!)}
        </StatusBadge>
      ) : (
        <StatusBadge kind="key" status="active" />
      ),
  });

  const createButton = (
    <CreateKeyButton
      id={CREATE_BUTTON_ID}
      onClick={openCreate}
      aria-disabled={atCap || undefined}
      aria-describedby={atCap ? CAP_REASON_ID : undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    />
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
        // the old key of a rotation reads quieter: it is on its way out
        rowClassName={(k) => (isReplaced(k) ? 'text-muted-foreground' : undefined)}
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
        onIssued={(issued) => show(createdKey(issued))}
        onCloseAutoFocus={(e) => void focusIssued(e)}
      />
      <RotateKeyDialog
        target={rotating}
        onClose={() => setRotating(null)}
        onIssued={(issued, grace) => show(createdKey(issued, grace), issued.id)}
        onCloseAutoFocus={(e) => {
          if (focusIssued(e)) return;
          e.preventDefault();
          const f = focusAfter.current;
          focusRowMenu(TABLE, f ? [f.own, f.next, f.prev] : [], () =>
            document.getElementById(CREATE_BUTTON_ID),
          );
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
        {...PAGE_HEADS.keys}
        description={
          limits && rows
            ? `Keys let your server call the API. ${formatCount(rows.length)} of ${formatCount(limits.maxKeys)} used.`
            : 'Keys let your server call the API.'
        }
        primaryAction={primary}
      />
      {created.map((c) => (
        <KeyCreatedNotice key={c.id} created={c} onDismiss={() => dismiss(c.id)} />
      ))}
      {table}
      {dialogs}
    </>
  );
}
