'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { usePortalContainer } from '@/components/ui/portal-container';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';

// not modal by default: a modal menu aria-hides the page around it, links
// and buttons included, which screen readers see as hidden but focusable
// (axe aria-hidden-focus). Escape, a click outside and arrow keys work the
// same; a page that needs the old behavior can pass modal
function DropdownMenu({
  modal = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" modal={modal} {...props} />;
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  portal = true,
  container,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /**
   * false renders the menu where it is written instead of at the end of the
   * body, so a menu that is not modal stays inside its landmark (the top
   * bar's banner) for screen readers
   */
  portal?: boolean;
  /** where the menu mounts; the shell's overlay root by default */
  container?: HTMLElement | null;
}) {
  const defaultContainer = usePortalContainer();
  const content = (
    <DropdownMenuPrimitive.Content
      data-slot="dropdown-menu-content"
      sideOffset={sideOffset}
      align={align}
      className={cn(
        'z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-menu duration-100 data-[state=closed]:overflow-hidden data-open:animate-enter data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
  return portal ? (
    <DropdownMenuPrimitive.Portal container={container ?? defaultContainer}>
      {content}
    </DropdownMenuPrimitive.Portal>
  ) : (
    content
  );
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium pointer-coarse:min-h-11 outline-hidden select-none focus:bg-muted focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground data-inset:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-muted data-[variant=destructive]:focus:text-destructive data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex min-h-9 cursor-default items-center gap-2.5 rounded-md py-1.5 pr-8 pl-2.5 text-sm font-medium pointer-coarse:min-h-11 outline-hidden select-none focus:bg-muted focus:text-foreground focus:**:text-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex min-h-9 cursor-default items-center gap-2.5 rounded-md py-1.5 pr-8 pl-2.5 text-sm font-medium pointer-coarse:min-h-11 outline-hidden select-none focus:bg-muted focus:text-foreground focus:**:text-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        'px-2.5 pt-2 pb-1 text-xs font-semibold text-subtle-foreground data-inset:pl-8',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('mx-1 my-1.5 h-px bg-border', className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto font-mono text-xs font-normal text-subtle-foreground', className)}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium pointer-coarse:min-h-11 outline-hidden select-none focus:bg-muted focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground data-inset:pl-8 data-open:bg-muted data-open:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  // portaled like the menu itself: inside it, the menu's positioned wrapper
  // holds the submenu and its overflow clips whatever opens past its edge
  return (
    <DropdownMenuPrimitive.Portal container={usePortalContainer()}>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(
          'z-50 min-w-[96px] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-menu duration-100 data-open:animate-enter data-closed:animate-out data-closed:fade-out-0',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
