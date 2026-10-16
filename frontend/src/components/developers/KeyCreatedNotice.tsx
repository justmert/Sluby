import { useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Check, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CopyButton } from '@/components/shared/CopyButton';
import { Button } from '@/components/ui/button';
import { maskKey } from './key-label';
import { useLeaveGuard } from './leave-guard';

export interface CreatedKey {
  /** the key's id, which names its copy button for focus */
  id: string;
  /** the key's name, as people typed it */
  name: string;
  /** the full secret, which the server returns this once */
  value: string;
  rotated: boolean;
  /** a line under the heading, such as when the old key stops */
  note?: ReactNode;
}

/**
 * A key the server just issued, on the page above the table instead of in a
 * dialog. The secret stays here until it is copied or dismissed: closing it
 * uncopied asks first, and so does leaving the page (a link, a reload or a
 * closed tab), since the key cannot be shown again.
 */
export function KeyCreatedNotice({
  created,
  onDismiss,
}: {
  created: CreatedKey;
  onDismiss: () => void;
}) {
  const id = useId();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const [asking, setAsking] = useState(false);
  const guard = useLeaveGuard(!copied, (to) => void navigate(to));

  const dismiss = () => (copied ? onDismiss() : setAsking(true));

  return (
    <div
      role="status"
      aria-labelledby={`${id}-title`}
      className="flex animate-enter flex-wrap items-center gap-3.5 rounded-xl border bg-card px-4.5 py-4 shadow-xs"
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-success-line"
      >
        <Check className="size-4 text-success" strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-[1_1_16.25rem]">
        <p id={`${id}-title`} className="text-sm font-semibold">
          Key “<span dir="auto">{created.name}</span>” {created.rotated ? 'rotated' : 'created'}
        </p>
        <p className="text-sm text-muted-foreground">
          {copied ? 'Copied. Store it on your server.' : 'Copy it now. It is shown only once.'}
          {created.note && <> {created.note}</>}
        </p>
      </div>
      <span
        id={`${id}-key`}
        className={
          shown
            ? 'min-w-0 basis-full rounded-lg border px-2.5 py-1.5 font-mono text-sm break-all'
            : 'rounded-lg border px-2.5 py-1.5 font-mono text-sm'
        }
        aria-label={shown ? 'API key' : 'API key, hidden'}
      >
        {shown ? created.value : maskKey(created.value)}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          className="h-9 px-3 text-muted-foreground"
          aria-controls={`${id}-key`}
          aria-expanded={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide' : 'Show'}
        </Button>
        <div data-key-copy={created.id} className="contents">
          <CopyButton
            value={created.value}
            label="Copy key"
            text="Copy key"
            withText
            variant={copied ? 'outline' : 'default'}
            className="h-9 px-3.5 text-sm"
            onCopied={() => setCopied(true)}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label={copied ? 'Done' : 'Close without copying'}
          onClick={dismiss}
        >
          <X />
        </Button>
      </div>

      <ConfirmDialog
        item={asking || guard.pending ? true : null}
        onClose={() => {
          setAsking(false);
          guard.stay();
        }}
        title={guard.pending ? 'Leave without the key?' : 'Close without copying?'}
        description="This key is not shown again. Without it your server cannot use it, and you would have to create or rotate another."
        confirmLabel={guard.pending ? 'Leave' : 'Close'}
        destructive={false}
        onConfirm={() => {
          if (guard.pending) guard.leave();
          else onDismiss();
        }}
      />
    </div>
  );
}
