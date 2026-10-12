'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Tabs as TabsPrimitive } from 'radix-ui';

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  );
}

// two looks from the design: default is the segmented control (a sunken
// track, the chosen segment raised on the surface), line is the row of
// section tabs over a rule, the chosen one underlined in petrol
const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col',
  {
    variants: {
      variant: {
        default:
          'justify-center rounded-[9px] bg-sunken p-[3px] group-data-horizontal/tabs:h-9 pointer-coarse:group-data-horizontal/tabs:h-11',
        line: 'gap-6 border-b group-data-horizontal/tabs:h-10 group-data-vertical/tabs:border-b-0',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-design outline-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // a segment: 30px, 13px type, a press to 97%
        'group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:flex-1 group-data-[variant=default]/tabs-list:rounded-[7px] group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:text-[13px] group-data-[variant=default]/tabs-list:data-active:bg-card group-data-[variant=default]/tabs-list:data-active:shadow-[0_1px_2px_var(--shadow-tint)] group-data-[variant=default]/tabs-list:motion-safe:active:scale-[0.97]',
        // a section tab: 40px, the 2px underline sits on the list's rule
        'group-data-[variant=line]/tabs-list:-mb-px group-data-[variant=line]/tabs-list:h-10 group-data-[variant=line]/tabs-list:border-b-2 group-data-[variant=line]/tabs-list:border-transparent group-data-[variant=line]/tabs-list:px-0.5 group-data-[variant=line]/tabs-list:text-sm group-data-[variant=line]/tabs-list:data-active:border-primary',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'flex-1 rounded-lg text-sm transition-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-150',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
