import type { ReactNode } from 'react';

// one settings section: its heading and a line about it in a label column,
// the content beside it, a rule above. the two wrap onto one column once
// the page is too narrow for both: the label column wants 220px, the
// content 420px
export const SETTINGS_SECTION =
  'flex flex-wrap gap-x-8 gap-y-3 border-t py-6 [&>:first-child]:max-w-70 [&>:first-child]:flex-[1_1_13.75rem] [&>:last-child]:min-w-0 [&>:last-child]:flex-[999_1_26.25rem]';

/** The label column: the section's h2 and a muted line under it. */
export function SectionLabel({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 id={id} className="font-heading text-heading">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
