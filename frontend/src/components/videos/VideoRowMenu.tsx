import { MoreHorizontal } from 'lucide-react';
import type { RowAction } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * A video's actions behind its ⋯ button, in the table, the grid and the
 * phone cards (videoActions). Destructive items go last, after a separator,
 * and every item has an icon (VIS-23).
 */
export function VideoRowMenu({
  actions,
  title,
  className,
}: {
  actions: RowAction[];
  /** the video's title, for the button's name: "Actions for Product walkthrough" */
  title: string;
  className?: string;
}) {
  const normal = actions.filter((a) => !a.destructive);
  const danger = actions.filter((a) => a.destructive);
  return (
    // not modal: a modal menu hides the rest of the page from screen readers
    // with aria-hidden while its controls stay focusable (axe aria-hidden-focus)
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('text-secondary-foreground', className)}
          aria-label={`Actions for ${title}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-60">
        {normal.map((a) => (
          <DropdownMenuItem key={a.label} onSelect={a.onSelect} disabled={a.disabled}>
            <a.icon aria-hidden="true" />
            {a.label}
          </DropdownMenuItem>
        ))}
        {normal.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map((a) => (
          <DropdownMenuItem
            key={a.label}
            variant="destructive"
            onSelect={a.onSelect}
            disabled={a.disabled}
          >
            <a.icon aria-hidden="true" />
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
