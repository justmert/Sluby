import type { ComponentProps } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/constants';
import { Icons } from '@/lib/icons';
import { preloadPage } from '@/lib/page-chunks';
import { cn } from '@/lib/utils';

// the pages' primary actions and header placeholders, shared with the route
// skeletons (page-heads.ts) so both draw the same boxes

type ButtonProps = ComponentProps<typeof Button>;

/** A link to the upload page that looks like the page's primary button. */
export function UploadVideoButton(props: Omit<ButtonProps, 'asChild' | 'children'>) {
  return (
    <Button {...props} asChild>
      <Link
        to={ROUTES.UPLOAD}
        // fetch the page's code while the pointer is on its way
        onPointerEnter={() => preloadPage(ROUTES.UPLOAD)}
        onFocus={() => preloadPage(ROUTES.UPLOAD)}
      >
        <Icons.upload />
        Upload video
      </Link>
    </Button>
  );
}

/** The upload page's way back to the list. */
export function BackToVideosButton() {
  return (
    <Button variant="outline" asChild>
      <Link to={ROUTES.VIDEOS}>Back to videos</Link>
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
