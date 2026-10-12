import { useRef, useState } from 'react';
import { InlineError } from '@/components/shared/InlineError';
import { CopyButton } from '@/components/shared/CopyButton';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useUpdateWebhook, type WebhookEventName, type WebhookRecord } from '@/hooks/useWebhooks';
import { toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { EventsEditor } from './EventsEditor';
import { WEBHOOK_EVENTS } from './options';

const CARD = 'flex flex-col gap-2.5 rounded-xl border bg-card px-5 py-4.5';

const sameEvents = (a: string[], b: string[]) =>
  a.length === b.length && a.every((e) => b.includes(e));

/** The events in the order they happen, with any the studio does not know yet at the end. */
function eventRows(events: string[]) {
  const known = WEBHOOK_EVENTS.filter((e) => events.includes(e.value));
  const other = events
    .filter((e) => !WEBHOOK_EVENTS.some((k) => k.value === e))
    .map((value) => ({ value, detail: '' }));
  return [...known, ...other];
}

/**
 * The events a webhook gets: a list of their api names and what each means,
 * and Edit, which turns it into the checkboxes with Cancel and Save.
 */
export function EventsCard({ hook }: { hook: WebhookRecord }) {
  const update = useUpdateWebhook();
  const [draft, setDraft] = useState<WebhookEventName[] | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const editing = draft !== null;
  const dirty = editing && !sameEvents(draft, hook.events);
  const error = editing && draft.length === 0 ? 'Choose at least one event.' : null;

  // focus goes back to Edit once the checkboxes leave, so the keyboard is not dropped on the page
  const done = () => {
    update.reset();
    setDraft(null);
    requestAnimationFrame(() => editRef.current?.focus());
  };

  const save = async () => {
    if (!draft || error || !dirty) return;
    try {
      await update.mutateAsync({ id: hook.id, patch: { events: draft } });
      toastSuccess('Events saved');
      done();
    } catch {
      // shown under the events, which keep what was ticked
    }
  };

  return (
    <section aria-labelledby="events-title" className={CARD}>
      <div className="flex items-center gap-2">
        <h2 id="events-title" className="font-heading text-heading">
          Events
        </h2>
        {!editing && (
          <Button
            ref={editRef}
            variant="ghost"
            aria-label="Edit events"
            className="ml-auto h-7 px-2.5 text-muted-foreground"
            onClick={() => {
              setDraft(hook.events);
              // the first checkbox takes focus as the editor appears
              requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[id^="edit-event-"]')?.focus(),
              );
            }}
          >
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-4">
          <EventsEditor
            value={draft}
            onChange={(next) => {
              update.reset();
              setDraft(next);
            }}
            error={error}
            disabled={update.isPending}
            idPrefix="edit-event"
            hideLegend
          />
          <InlineError error={update.error} title="Could not save the events" />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={done} disabled={update.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={update.isPending || !!error || !dirty}
              aria-busy={update.isPending || undefined}
            >
              {update.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {eventRows(hook.events).map((e) => (
            <li key={e.value} className="flex flex-wrap items-baseline gap-x-2.5">
              <span className="font-mono text-[13px]">{e.value}</span>
              {e.detail && <span className="text-muted-foreground">{e.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const SECRET_COPY_ID = 'signing-secret-copy';
export const ROTATE_SECRET_ID = 'rotate-secret-button';

/** "whsec_••••••••••••3f9a": the real secret with all but its kind and last four hidden. */
function maskSecret(secret: string): string {
  const cut = secret.indexOf('_') + 1;
  const tail = secret.slice(-4);
  return `${secret.slice(0, cut)}${'•'.repeat(12)}${tail}`;
}

/**
 * The signing secret. The server hands it out once, when the webhook is added
 * or the secret rotated, and never again, so this card only shows a value
 * right after a rotation on this page: masked, with Reveal and Copy, until
 * "I copied it". Otherwise it says how to get a new one.
 */
export function SigningSecretCard({
  secret,
  onRotate,
  onCopied,
  onDismiss,
}: {
  /** a secret this page just got from a rotation, or null */
  secret: string | null;
  onRotate: () => void;
  onCopied: () => void;
  onDismiss: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [shownFor, setShownFor] = useState(secret);
  // a new secret starts masked again
  if (shownFor !== secret) {
    setShownFor(secret);
    setRevealed(false);
  }

  return (
    <section aria-labelledby="secret-title" className={CARD}>
      <h2 id="secret-title" className="font-heading text-heading">
        Signing secret
      </h2>
      <p className="text-muted-foreground">
        Check every request&rsquo;s{' '}
        <code className="font-mono text-[13px] text-foreground">X-Sluby-Signature-V1</code> header
        with this secret.
      </p>
      {secret ? (
        <div role="status" className="flex animate-enter flex-col gap-2.5">
          <p>
            <strong className="font-semibold">New secret.</strong> Copy it now and set it as{' '}
            <code className="font-mono text-[13px]">SLUBY_WEBHOOK_SECRET</code> on your server. It
            is not shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-label={revealed ? 'Signing secret' : 'Signing secret, hidden'}
              className={cn(
                'min-w-0 flex-1 basis-48 rounded-lg border px-2.5 py-1.5 font-mono text-[13px]',
                revealed && 'break-all',
              )}
            >
              {revealed ? secret : maskSecret(secret)}
            </span>
            <Button
              variant="outline"
              className="h-8"
              aria-pressed={revealed}
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </Button>
            <span id={SECRET_COPY_ID} className="contents">
              <CopyButton
                value={secret}
                withText
                variant="outline"
                label="Copy signing secret"
                className="h-8"
                onCopied={onCopied}
              />
            </span>
          </div>
          <Button variant="outline" className="self-start" onClick={onDismiss}>
            I copied it
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">
          It was shown once, when this webhook was added. Rotate it if it is lost or leaked.
        </p>
      )}
      <Button id={ROTATE_SECRET_ID} variant="outline" className="self-start" onClick={onRotate}>
        Rotate secret
      </Button>
    </section>
  );
}
