import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Webhook } from 'lucide-react';
import { AddWebhookDialog } from '@/components/developers/AddWebhookDialog';
import { emptyWebhookForm, type WebhookForm } from '@/components/developers/forms';
import { useCreateParam } from '@/components/developers/create-param';
import {
  focusRowMenu,
  focusTargets,
  rowFocus,
  type RowFocus,
} from '@/components/developers/row-focus';
import {
  SecretRevealDialog,
  type RevealedSecret,
} from '@/components/developers/SecretRevealDialog';
import { LastDelivery } from '@/components/developers/webhook-parts';
import {
  TestIcon,
  pauseIcon,
  pauseLabel,
  useWebhookActions,
  webhookSecret,
} from '@/components/developers/webhook-actions';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { withCells } from '@/components/shared/column-frames';
import { WEBHOOK_COLUMNS } from '@/components/developers/columns';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useDeleteWebhook,
  useWebhooks,
  webhookLabel,
  type WebhookRecord,
} from '@/hooks/useWebhooks';
import { ROUTES } from '@/lib/constants';
import { usePersistedDraft } from '@/lib/drafts';
import { plural } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { toastSuccess } from '@/lib/toast';

const TABLE = 'Webhooks';
const ADD_BUTTON_ID = 'add-webhook-button';

export default function WebhooksPage() {
  const navigate = useNavigate();
  const hooks = useWebhooks();
  const remove = useDeleteWebhook();
  const actions = useWebhookActions();
  const rows = hooks.data?.data;

  const [creating, setCreating] = useCreateParam('webhook');
  const [form, setForm] = useState<WebhookForm>(emptyWebhookForm);
  usePersistedDraft('add-webhook', creating ? form : null, (draft) => {
    setForm(draft);
    setCreating(true);
  });
  const [revealed, setRevealed] = useState<{ secret: RevealedSecret; rowId: string } | null>(null);
  const [deleting, setDeleting] = useState<WebhookRecord | null>(null);
  // where focus goes once the delete dialog closes
  const focusAfter = useRef<RowFocus | null>(null);

  const openCreate = () => {
    setForm(emptyWebhookForm());
    setCreating(true);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Webhooks"
        description="Requests this server sends you when a video changes"
        primaryAction={
          <Button id={ADD_BUTTON_ID} onClick={openCreate}>
            <Plus />
            Add webhook
          </Button>
        }
      />
      <DataTable
        caption={TABLE}
        rows={rows}
        getRowId={(w) => w.id}
        getRowLabel={(w) => webhookLabel(w.url)}
        onRowClick={(w) => void navigate(ROUTES.webhook(w.id))}
        animateRows
        loadingRows={3}
        error={hooks.error}
        onRetry={() => hooks.refetch()}
        retrying={hooks.isFetching}
        what="webhooks"
        columns={withCells<WebhookRecord>(WEBHOOK_COLUMNS, {
          url: (w) => (
            <Link
              to={ROUTES.webhook(w.id)}
              title={w.url}
              className="line-clamp-2 rounded-sm font-mono text-xs font-normal wrap-anywhere hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
            >
              {w.url}
            </Link>
          ),
          events: (w) => (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="rounded-sm underline decoration-dotted underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {plural(w.events.length, 'event')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span className="font-mono">{w.events.join(', ')}</span>
              </TooltipContent>
            </Tooltip>
          ),
          last: (w) => <LastDelivery hook={w} />,
          status: (w) => <StatusBadge kind="webhook" status={w.isActive ? 'active' : 'inactive'} />,
        })}
        rowActions={(w) => [
          {
            label: 'Send test',
            icon: TestIcon,
            disabled: actions.testing === w.id,
            onSelect: () => void actions.sendTest(w),
          },
          {
            label: pauseLabel(w),
            icon: pauseIcon(w),
            disabled: actions.updating === w.id,
            onSelect: () => void actions.setActive(w, !w.isActive),
          },
          {
            label: 'Delete',
            icon: Icons.delete,
            destructive: true,
            onSelect: () => {
              focusAfter.current = rowFocus(rows, w, (r) => r.id);
              setDeleting(w);
            },
          },
        ]}
        empty={
          <EmptyState
            icon={Webhook}
            title="No webhooks yet"
            description="Get a request on your server when a video is ready or fails."
            action={
              <Button onClick={openCreate}>
                <Plus />
                Add webhook
              </Button>
            }
          />
        }
      />

      <AddWebhookDialog
        open={creating}
        onOpenChange={setCreating}
        form={form}
        onFormChange={setForm}
        existingUrls={rows?.map((w) => w.url) ?? []}
        onCreated={(created) =>
          setRevealed({ secret: webhookSecret(created.secret), rowId: created.id })
        }
      />
      <SecretRevealDialog
        secret={revealed?.secret ?? null}
        onClose={() => setRevealed(null)}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusRowMenu(TABLE, [revealed?.rowId], () => document.getElementById(ADD_BUTTON_ID));
        }}
      />
      <ConfirmDialog
        item={deleting}
        onClose={() => setDeleting(null)}
        title="Delete this webhook?"
        description={(hook) => (
          <>
            Events stop going to{' '}
            <span className="line-clamp-3 font-mono break-all" title={hook.url}>
              {hook.url}
            </span>{' '}
            right away, and its delivery log is deleted. This cannot be undone.
          </>
        )}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        errorTitle="Could not delete the webhook"
        onConfirm={async (hook) => {
          await remove.mutateAsync(hook.id);
          if (focusAfter.current) focusAfter.current.gone = true;
          toastSuccess('Webhook deleted');
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const f = focusAfter.current;
          focusRowMenu(TABLE, f ? focusTargets(f) : [], () =>
            document.getElementById(ADD_BUTTON_ID),
          );
        }}
      />
    </PageContainer>
  );
}
