import type { ComponentProps } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/utils';

// the pages' primary actions and header placeholders, shared with the route
// skeletons (page-heads.ts) so both draw the same boxes

type ButtonProps = ComponentProps<typeof Button>;

export function UploadVideoButton(props: ButtonProps) {
  return (
    <Button {...props}>
      <Icons.upload />
      Upload video
    </Button>
  );
}

export function CreateKeyButton(props: ButtonProps) {
  return (
    <Button {...props}>
      <Plus />
      Create key
    </Button>
  );
}

export function AddWebhookButton(props: ButtonProps) {
  return (
    <Button {...props}>
      <Plus />
      Add webhook
    </Button>
  );
}

/** The videos count line before it is known: a bar of its size, in the p. */
export function StatsLinePlaceholder({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-4 w-32 rounded-md bg-muted align-middle', className)}
    />
  );
}
