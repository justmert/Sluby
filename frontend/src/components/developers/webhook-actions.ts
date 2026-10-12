import { CirclePause, CirclePlay, Send } from 'lucide-react';
import { useTestWebhook, useUpdateWebhook, type WebhookRecord } from '@/hooks/useWebhooks';
import { withLead } from '@/lib/errors';
import { toastError, toastSuccess } from '@/lib/toast';
import type { RevealedSecret } from './SecretRevealDialog';

/** "Not delivered: connect ECONNREFUSED" reads as a sentence with a period. */
const sentence = (text: string) => {
  const t = text.trim();
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped.slice(0, -1) : capped;
};

/** Send test and pause or resume, with their toasts, for the list and the detail page. */
export function useWebhookActions() {
  const test = useTestWebhook();
  const update = useUpdateWebhook();

  const sendTest = async (hook: WebhookRecord) => {
    try {
      const result = await test.mutateAsync(hook.id);
      if (result.delivered) {
        // a test reaches a paused webhook too, which is how a receiver is
        // checked before resuming; say so, since real events stay paused
        toastSuccess(
          hook.isActive
            ? `Test delivered (your endpoint answered ${result.statusCode})`
            : `Test delivered while paused (your endpoint answered ${result.statusCode})`,
        );
      } else {
        toastError(
          result.error
            ? `Test not delivered. ${sentence(result.error)}`
            : result.statusCode == null
              ? 'Test not delivered. Your endpoint did not answer'
              : `Test not delivered. Your endpoint answered ${result.statusCode}`,
        );
      }
    } catch (err) {
      toastError(withLead('Could not send the test', err));
    }
  };

  const setActive = async (hook: WebhookRecord, active: boolean) => {
    try {
      await update.mutateAsync({ id: hook.id, patch: { isActive: active } });
      toastSuccess(active ? 'Webhook resumed' : 'Webhook paused');
    } catch (err) {
      toastError(
        withLead(active ? 'Could not resume the webhook' : 'Could not pause the webhook', err),
      );
    }
  };

  return {
    sendTest,
    setActive,
    testing: test.isPending ? test.variables : undefined,
    updating: update.isPending ? update.variables?.id : undefined,
  };
}

export const pauseIcon = (hook: WebhookRecord) => (hook.isActive ? CirclePause : CirclePlay);
export const pauseLabel = (hook: WebhookRecord) => (hook.isActive ? 'Pause' : 'Resume');
export const TestIcon = Send;

/**
 * What the secret dialog shows for a new webhook. A rotated secret shows in
 * the webhook page's signing secret card instead.
 */
export const webhookSecret = (secret: string): RevealedSecret => ({
  title: 'Webhook added',
  description: 'Copy the signing secret now. You will not be able to see it again.',
  value: secret,
  label: 'signing secret',
  envName: 'SLUBY_WEBHOOK_SECRET',
});
