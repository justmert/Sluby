import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronDown, Copy, Pause } from 'lucide-react';
import { DeliveriesTable } from '@/components/developers/DeliveriesTable';
import {
  EventsCard,
  ROTATE_SECRET_ID,
  SECRET_COPY_ID,
  SigningSecretCard,
} from '@/components/developers/webhook-cards';
import { useLeaveGuard } from '@/components/developers/leave-guard';
import { PauseIcon } from '@/components/developers/webhook-parts';
import { TestIcon, pauseLabel, useWebhookActions } from '@/components/developers/webhook-actions';
import { PageContainer } from '@/components/layout/PageContainer';
import { WebhookDetailLoading } from '@/components/developers/WebhookDetailLoading';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageState } from '@/components/shared/PageState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
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
  useWebhook,
  type WebhookRecord,
} from '@/hooks/useWebhooks';
import { statusOf } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import { Icons } from '@/lib/icons';
import { toastError, toastSuccess } from '@/lib/toast';

const PAUSED_NOTE_ID = 'paused-note';

const backToWebhooks = (
  <Button variant="outline" asChild>
    <Link to={ROUTES.WEBHOOKS}>Back to webhooks</Link>
  </Button>
);

async function copyText(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toastSuccess(`${what} copied`);
  } catch {
    // the clipboard needs a secure context and permission; say so instead of pretending
    toastError(`Could not copy the ${what.toLowerCase()}. The clipboard is not available here`);
  }
}

function Loading() {
  return (
    <PageContainer>
      <h1 className="sr-only">Loading webhook</h1>
      <WebhookDetailLoading />
    </PageContainer>
  );
}

/** Resume, Send test and More for a paused webhook; Send test, Pause and More for a live one. */
function HeaderActions({
  hook,
  moreRef,
  onDelete,
}: {
  hook: WebhookRecord;
  moreRef: React.RefObject<HTMLButtonElement | null>;
  onDelete: () => void;
}) {
  const actions = useWebhookActions();
  const testing = actions.testing === hook.id;
  const updating = actions.updating === hook.id;

  const toggle = (
    <Button
      key="toggle"
      variant={hook.isActive ? 'outline' : 'default'}
      onClick={() => void actions.setActive(hook, !hook.isActive)}
      disabled={updating}
      aria-busy={updating || undefined}
    >
      {updating ? (
        <Spinner data-icon="inline-start" aria-hidden="true" />
      ) : (
        <PauseIcon active={hook.isActive} />
      )}
      {pauseLabel(hook)}
    </Button>
  );
  const test = (
    <Button
      key="test"
      variant="outline"
      onClick={() => void actions.sendTest(hook)}
      disabled={testing}
      aria-describedby={hook.isActive ? undefined : PAUSED_NOTE_ID}
      aria-busy={testing || undefined}
    >
      {testing ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <TestIcon />}
      {testing ? 'Sending…' : 'Send test'}
    </Button>
  );

  return (
    <div className="ml-auto flex flex-wrap gap-2">
      {/* the main way out of the state comes first: Resume when paused */}
      {hook.isActive ? [test, toggle] : [toggle, test]}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={moreRef} variant="outline" aria-label="More actions for this webhook">
            More
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-52">
          <DropdownMenuItem onSelect={() => void copyText(hook.url, 'Endpoint URL')}>
            <Copy aria-hidden="true" />
            Copy endpoint URL
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyText(hook.id, 'Webhook ID')}>
            <Copy aria-hidden="true" />
            Copy webhook ID
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Icons.delete aria-hidden="true" />
            Delete webhook
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function WebhookDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useWebhook(id);
  const rotate = useRotateWebhookSecret();
  const remove = useDeleteWebhook();
  const [confirm, setConfirm] = useState<'rotate' | 'delete' | null>(null);
  // a secret from a rotation on this page; the server never shows it again
  const [fresh, setFresh] = useState<{ secret: string; copied: boolean } | null>(null);
  const guard = useLeaveGuard(fresh !== null && !fresh.copied, (to) => void navigate(to));
  // the delete dialog opens from the More menu, whose item is gone once it
  // closes, so focus goes back to the menu's button
  const moreRef = useRef<HTMLButtonElement>(null);
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

  return (
    <PageContainer>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 font-mono text-[22px] leading-8 font-medium wrap-anywhere">
            {hook.url}
          </h1>
          <StatusBadge kind="webhook" status={hook.isActive ? 'active' : 'inactive'} live />
          <HeaderActions hook={hook} moreRef={moreRef} onDelete={() => setConfirm('delete')} />
        </div>

        {!hook.isActive && (
          <p
            id={PAUSED_NOTE_ID}
            className="flex animate-enter items-start gap-3 rounded-xl border bg-card px-4 py-3.5"
          >
            {/* amber is the attention hue; the card itself stays neutral */}
            <Pause aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-warning-icon" />
            <span>
              <strong className="font-semibold">Paused.</strong> No events are sent to this
              endpoint. Send test still delivers a test request, so you can check your receiver
              before you resume.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-4">
            <EventsCard hook={hook} />
            <SigningSecretCard
              secret={fresh?.secret ?? null}
              onRotate={() => setConfirm('rotate')}
              onCopied={() => setFresh((f) => f && { ...f, copied: true })}
              onDismiss={() => {
                setFresh(null);
                requestAnimationFrame(() => document.getElementById(ROTATE_SECRET_ID)?.focus());
              }}
            />
          </div>
          <DeliveriesTable webhookId={hook.id} paused={!hook.isActive} />
        </div>
      </div>

      <ConfirmDialog
        item={confirm === 'rotate' ? hook : null}
        onClose={() => setConfirm(null)}
        title="Rotate the signing secret?"
        description="Requests are signed with the new secret right away, and checks with the old one start failing. This cannot be undone."
        confirmLabel="Rotate secret"
        pendingLabel="Rotating…"
        errorTitle="Could not rotate the signing secret"
        onCloseAutoFocus={(e) => {
          // a new secret lands on its Copy button; a cancel goes back to Rotate secret
          const copy = document.querySelector<HTMLElement>(`#${SECRET_COPY_ID} button`);
          if (!copy) return;
          e.preventDefault();
          copy.focus();
        }}
        onConfirm={async (h) => {
          const { secret } = await rotate.mutateAsync(h.id);
          rotate.reset();
          toastSuccess('Signing secret rotated');
          setFresh({ secret, copied: false });
        }}
      />
      <ConfirmDialog
        item={confirm === 'delete' ? hook : null}
        onClose={() => setConfirm(null)}
        title="Delete this webhook?"
        description={(h) => (
          <>
            Events stop going to{' '}
            <span className="line-clamp-3 font-mono break-all" title={h.url}>
              {h.url}
            </span>{' '}
            right away, and its delivery log is deleted. This cannot be undone.
          </>
        )}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        errorTitle="Could not delete the webhook"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          moreRef.current?.focus();
        }}
        onConfirm={async (h) => {
          await remove.mutateAsync(h.id);
          // nothing is left to protect once the webhook is gone
          setFresh(null);
          toastSuccess('Webhook deleted');
          void navigate(ROUTES.WEBHOOKS, { replace: true });
        }}
      />
      <ConfirmDialog
        item={guard.pending}
        onClose={guard.stay}
        title="Leave without the secret?"
        description="The new signing secret is not shown again. Without it your server cannot check that requests come from this server, and you would have to rotate it again."
        confirmLabel="Leave"
        onConfirm={guard.leave}
      />
    </PageContainer>
  );
}
