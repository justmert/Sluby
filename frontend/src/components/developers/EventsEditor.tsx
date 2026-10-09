import { OptionList } from './OptionList';
import type { WebhookEventName } from '@/hooks/useWebhooks';
import { WEBHOOK_EVENTS } from './options';

/** The webhook events as checkboxes, for adding a webhook and editing one. */
export function EventsEditor({
  value,
  onChange,
  error,
  disabled,
  idPrefix = 'event',
  hideLegend,
  className,
}: {
  value: WebhookEventName[];
  onChange: (next: WebhookEventName[]) => void;
  error?: string | null;
  disabled?: boolean;
  idPrefix?: string;
  hideLegend?: boolean;
  className?: string;
}) {
  // keep the order the events happen in, whatever order they were ticked
  const ordered = (next: string[]) =>
    WEBHOOK_EVENTS.map((e) => e.value).filter((v) => next.includes(v));
  return (
    <OptionList
      legend="Events"
      options={WEBHOOK_EVENTS}
      value={value}
      onChange={(next) => onChange(ordered(next))}
      idPrefix={idPrefix}
      error={error}
      disabled={disabled}
      hideLegend={hideLegend}
      className={className}
    />
  );
}
