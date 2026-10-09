import { MoreHorizontal } from 'lucide-react';
import type { RowAction } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * A video's actions as a menu, for the grid cards; the table draws the same
 * list (videoActions) through DataTable's row menu. Destructive items go last,
 * after a separator, and every item has an icon (VIS-23).
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('pointer-coarse:size-10', className)}
          aria-label={`Actions for ${title}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
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
