import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { CodeBlock } from '@/components/shared/CodeBlock';
import { CopyField } from '@/components/shared/CopyField';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFrozen } from '@/hooks/useFrozen';

export interface RevealedSecret {
  /** "API key created", "Signing secret rotated" */
  title: string;
  /** what it is and that it is shown once, as full sentences */
  description: ReactNode;
  value: string;
  /** names the value for the copy buttons: "API key", "signing secret" */
  label: string;
  /** the environment variable the server reads it from */
  envName: string;
  /** a line under the value, such as when the old key stops */
  note?: ReactNode;
}

/**
 * Shows a key or signing secret the server returns only once. Escape and a
 * click outside do nothing until it was copied, so a stray key press cannot
 * lose it; "I copied it" always closes (FLW-50).
 */
export function SecretRevealDialog({
  secret,
  onClose,
  onCloseAutoFocus,
}: {
  secret: RevealedSecret | null;
  onClose: () => void;
  /** where focus goes once it closes, when the opener is gone */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const open = secret !== null;
  // the page clears `secret` on close; keep showing it while the dialog fades
  const shown = useFrozen(secret, open);
  const [copied, setCopied] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCopied(false);
  }
  const markCopied = () => setCopied(true);
  const hold = (e: Event) => {
    if (!copied) e.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={copied}
        onEscapeKeyDown={hold}
        onPointerDownOutside={hold}
        onInteractOutside={hold}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          {/* a neutral surface with a green check in a ring, not a tinted
              success box: the value below is what needs the attention */}
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-success/45"
            >
              <Check className="size-4 text-success" strokeWidth={2.4} />
            </span>
            <DialogTitle>{shown?.title}</DialogTitle>
          </div>
          <DialogDescription>{shown?.description}</DialogDescription>
        </DialogHeader>
        {shown && (
          <div className="flex min-w-0 flex-col gap-3">
            <CopyField
              label={shown.label}
              value={shown.value}
              onCopied={markCopied}
              className="h-9"
            />
            <CodeBlock
              code={`export ${shown.envName}=${shown.value}`}
              language="bash"
              label={`${shown.label} as an environment variable`}
              onCopied={markCopied}
              // the line wraps so the end of the value never hides under the copy button
              preClassName="whitespace-pre-wrap break-all"
            />
            {shown.note && <p className="text-sm text-muted-foreground">{shown.note}</p>}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>I copied it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
