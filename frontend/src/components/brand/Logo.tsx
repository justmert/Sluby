import { cn } from '@/lib/utils';

// the same drawing as public/favicon.svg: an s built from two quarter pipes on
// the brand orange, which stays the same in both themes. keep the two in step.
export const LOGO_PATH = 'M23 8.75h-9a3.625 3.625 0 0 0 0 7.25h4a3.625 3.625 0 0 1 0 7.25H9';

export function Logo({ className }: { className?: string }) {
  return (
    // decorative: the name always sits next to it, and a screen reader would
    // otherwise hear it twice
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      data-slot="logo"
      className={cn('size-8 shrink-0', className)}
    >
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path
        d={LOGO_PATH}
        fill="none"
        strokeWidth="4"
        strokeLinejoin="round"
        className="stroke-brand-foreground"
      />
    </svg>
  );
}
