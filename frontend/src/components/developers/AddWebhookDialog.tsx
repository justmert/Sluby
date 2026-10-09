import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { InlineError } from '@/components/shared/InlineError';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useCreateWebhook, type CreatedWebhook } from '@/hooks/useWebhooks';
import { EventsEditor } from './EventsEditor';
import { urlProblem, WEBHOOK_URL_MAX, type WebhookForm } from './forms';

/**
 * The form for a new webhook. The page owns the values so a draft survives
 * a session that ends while it is open (FLW-15). A URL that already
 * receives events gets a warning, not a refusal: two endpoints with one URL
 * and different events are fine (FLW-51).
 */
export function AddWebhookDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  existingUrls,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: WebhookForm;
  onFormChange: (form: WebhookForm) => void;
  existingUrls: string[];
  onCreated: (created: CreatedWebhook) => void;
}) {
  const create = useCreateWebhook();
  const [touched, setTouched] = useState({ url: false, events: false });
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTouched({ url: false, events: false });
  }

  const urlError = touched.url ? urlProblem(form.url) : null;
  const eventsError =
    touched.events && form.events.length === 0 ? 'Choose at least one event.' : null;
  const duplicate = existingUrls.includes(form.url.trim());

  const close = (next: boolean) => {
    if (!next) create.reset();
    onOpenChange(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    const badUrl = urlProblem(form.url);
    if (badUrl || form.events.length === 0) {
      setTouched({ url: true, events: true });
      document.getElementById(badUrl ? 'hook-url' : 'hook-event-upload.started')?.focus();
      return;
    }
    try {
      const created = await create.mutateAsync({ url: form.url.trim(), events: form.events });
      // the secret now lives only in the dialog that shows it once
      create.reset();
      onOpenChange(false);
      onCreated(created);
    } catch {
      // shown in the dialog, where the url can be fixed
    }
  };

  const describedBy = [urlError && 'hook-url-error', duplicate && 'hook-url-duplicate']
    .filter(Boolean)
    .join(' ');

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Add webhook</DialogTitle>
            <DialogDescription>
              We send a POST request here when one of your videos changes.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!urlError || undefined}>
              <FieldLabel htmlFor="hook-url">Endpoint URL</FieldLabel>
              <Input
                id="hook-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://example.com/sluby-hook"
                value={form.url}
                maxLength={WEBHOOK_URL_MAX}
                onChange={(e) => onFormChange({ ...form, url: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, url: form.url.trim() !== '' || t.url }))}
                aria-invalid={!!urlError || undefined}
                aria-describedby={describedBy || undefined}
                autoFocus
              />
              <FieldError id="hook-url-error">{urlError}</FieldError>
              {duplicate && !urlError && (
                <p id="hook-url-duplicate" className="flex gap-1.5 text-sm text-warning-foreground">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  This URL already receives events. Add it again only if you want every event twice.
                </p>
              )}
            </Field>
            <EventsEditor
              value={form.events}
              onChange={(events) => {
                setTouched((t) => ({ ...t, events: true }));
                onFormChange({ ...form, events });
              }}
              error={eventsError}
              idPrefix="hook-event"
            />
          </FieldGroup>
          <InlineError error={create.error} title="Could not add the webhook" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending}
              aria-busy={create.isPending || undefined}
            >
              {create.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {create.isPending ? 'Adding…' : 'Add webhook'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
