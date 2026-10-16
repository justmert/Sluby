import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// the type roles in index.css are font sizes; without this tailwind-merge
// reads text-title as a color and drops it next to text-muted-foreground
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['title', 'heading', 'figure', 'figure-sm', 'kbd'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
