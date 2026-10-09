import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CirclePause, MoreHorizontal } from 'lucide-react';
import { DeliveriesTable } from '@/components/developers/DeliveriesTable';
import { EventsEditor } from '@/components/developers/EventsEditor';
import {
  SecretRevealDialog,
  type RevealedSecret,
} from '@/components/developers/SecretRevealDialog';
import { LastDelivery, PauseIcon } from '@/components/developers/webhook-parts';
import {
  TestIcon,
  pauseLabel,
  useWebhookActions,
  webhookSecret,
} from '@/components/developers/webhook-actions';
import { PageContainer, PageHeader, SectionHeader } from '@/components/layout/PageContainer';
import { WebhookDetailLoading } from '@/components/developers/WebhookDetailLoading';
import { CodeBlock } from '@/components/shared/CodeBlock';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DescriptionItem, DescriptionList } from '@/components/shared/DescriptionList';
import { InlineError } from '@/components/shared/InlineError';
import { PageState } from '@/components/shared/PageState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import {
  useDeleteWebhook,
  useRotateWebhookSecret,
  useUpdateWebhook,
  useWebhook,
  webhookLabel,
  type WebhookEventName,
  type WebhookRecord,
} from '@/hooks/useWebhooks';
import { statusOf } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import { formatDate } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { RECEIVE_WEBHOOKS } from '@/lib/snippets';
import { toastSuccess } from '@/lib/toast';

const backToWebhooks = (
  <Button variant="outline" asChild>
    <Link to={ROUTES.WEBHOOKS}>Back to webhooks</Link>
  </Button>
);

const sameEvents = (a: string[], b: string[]) =>
  a.length === b.length && a.every((e) => b.includes(e));

/** The events the webhook gets, editable; Save changes appears once they differ. */
function EventsCard({ hook }: { hook: WebhookRecord }) {
  const update = useUpdateWebhook();
  const [draft, setDraft] = useState<WebhookEventName[] | null>(null);
  const events = draft ?? hook.events;
  const dirty = draft !== null && !sameEvents(draft, hook.events);
  const error = draft !== null && draft.length === 0 ? 'Choose at least one event.' : null;

  const save = async () => {
    if (!draft || error) return;
    try {
      await update.mutateAsync({ id: hook.id, patch: { events: draft } });
      setDraft(null);
      toastSuccess('Events saved');
    } catch {
      // shown under the events, which keep what was ticked
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <EventsEditor
          value={events}
          onChange={(next) => {
            update.reset();
            setDraft(next);
          }}
          error={error}
          disabled={update.isPending}
          idPrefix="edit-event"
          hideLegend
          className="@3xl/page:grid-flow-col @3xl/page:grid-rows-3"
        />
        <InlineError error={update.error} title="Could not save the events" />
        {dirty && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                update.reset();
                setDraft(null);
              }}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={update.isPending || !!error}
              aria-busy={update.isPending || undefined}
            >
              {update.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Loading() {
  return (
    <PageContainer>
      <h1 className="sr-only">Loading webhook</h1>
      <WebhookDetailLoading />
    </PageContainer>
  );
}

export default function WebhookDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useWebhook(id);
  const actions = useWebhookActions();
  const rotate = useRotateWebhookSecret();
  const remove = useDeleteWebhook();
  const [confirm, setConfirm] = useState<'rotate' | 'delete' | null>(null);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  // the dialogs open from the overflow menu, whose item is gone once they
  // close, so focus goes back to the menu's button
  const moreRef = useRef<HTMLButtonElement>(null);
  const backToMenu = (e: Event) => {
    e.preventDefault();
    moreRef.current?.focus();
  };
  const hook = query.data;

  if (!hook) {
    if (query.isError && statusOf(query.error) === 404) {
      return (
        <PageState
          title="Webhook not found"
          description="It may have been deleted."
          actions={backToWebhooks}
        />
      );
    }
    if (query.isError) {
      return (
        <PageState
          title="Could not load this webhook"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          actions={backToWebhooks}
        />
      );
    }
    return <Loading />;
  }

  const label = webhookLabel(hook.url);

  return (
    <PageContainer>
      <PageHeader
        title={label}
        meta={
          <>
            <StatusBadge kind="webhook" status={hook.isActive ? 'active' : 'inactive'} />
            <span aria-hidden="true">·</span>
            <span>Added {formatDate(hook.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              Last delivery <LastDelivery hook={hook} />
            </span>
          </>
        }
        secondaryActions={
          <>
            <Button
              variant="outline"
              onClick={() => void actions.sendTest(hook)}
              disabled={actions.testing === hook.id}
              aria-describedby={hook.isActive ? undefined : 'paused-note'}
              aria-busy={actions.testing === hook.id || undefined}
            >
              {actions.testing === hook.id ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <TestIcon />
              )}
              {actions.testing === hook.id ? 'Sending…' : 'Send test'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void actions.setActive(hook, !hook.isActive)}
              disabled={actions.updating === hook.id}
              aria-busy={actions.updating === hook.id || undefined}
            >
              {actions.updating === hook.id ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <PauseIcon active={hook.isActive} />
              )}
              {pauseLabel(hook)}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={moreRef}
                  variant="outline"
                  size="icon"
                  aria-label="More actions for this webhook"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-52">
                <DropdownMenuItem onSelect={() => setConfirm('rotate')}>
                  <Icons.rotate aria-hidden="true" />
                  Rotate signing secret
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirm('delete')}>
                  <Icons.delete aria-hidden="true" />
                  Delete webhook
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {!hook.isActive && (
        <p
          id="paused-note"
          className="-mt-2 mb-6 flex gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        >
          <CirclePause aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Paused: no events are sent to this endpoint. Send test still delivers a test request, so
          you can check your receiver before you resume.
        </p>
      )}

      <Card>
        <CardContent>
          <DescriptionList>
            <DescriptionItem label="Endpoint URL" mono copy={hook.url}>
              {hook.url}
            </DescriptionItem>
            <DescriptionItem label="Webhook ID" mono copy={hook.id}>
              {hook.id}
            </DescriptionItem>
          </DescriptionList>
        </CardContent>
      </Card>

      <SectionHeader title="Events" description="What this server sends to the endpoint" />
      <EventsCard key={hook.events.join()} hook={hook} />

      <SectionHeader title="Deliveries" description="The latest attempts, newest first" />
      <DeliveriesTable webhookId={hook.id} paused={!hook.isActive} />

      <SectionHeader
        title="Verify requests"
        description="Each request is signed so you can check it came from this server"
      />
      <CodeBlock code={RECEIVE_WEBHOOKS} language="ts" label="verify webhook requests" />

      <ConfirmDialog
        item={confirm === 'rotate' ? hook : null}
        onClose={() => setConfirm(null)}
        title="Rotate the signing secret?"
        description="Requests are signed with the new secret right away, and checks with the old one start failing. This cannot be undone."
        confirmLabel="Rotate secret"
        pendingLabel="Rotating…"
        errorTitle="Could not rotate the signing secret"
        onCloseAutoFocus={backToMenu}
        onConfirm={async (h) => {
          const { secret } = await rotate.mutateAsync(h.id);
          rotate.reset();
          toastSuccess('Signing secret rotated');
          setRevealed(webhookSecret(secret, true));
        }}
      />
      <ConfirmDialog
        item={confirm === 'delete' ? hook : null}
        onClose={() => setConfirm(null)}
        title="Delete this webhook?"
        description={(h) => (
          <>
            Events stop going to <span className="font-mono wrap-anywhere">{h.url}</span> right
            away, and its delivery log is deleted. This cannot be undone.
          </>
        )}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        errorTitle="Could not delete the webhook"
        onConfirm={async (h) => {
          await remove.mutateAsync(h.id);
          toastSuccess('Webhook deleted');
          void navigate(ROUTES.WEBHOOKS, { replace: true });
        }}
      />
      <SecretRevealDialog
        secret={revealed}
        onClose={() => setRevealed(null)}
        onCloseAutoFocus={backToMenu}
      />
    </PageContainer>
  );
}
