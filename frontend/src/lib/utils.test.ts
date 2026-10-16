import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps a type role next to a text color', () => {
    expect(cn('text-title', 'text-muted-foreground')).toBe('text-title text-muted-foreground');
    expect(cn('text-figure text-destructive')).toBe('text-figure text-destructive');
  });

  it('lets a later size replace a type role and the other way round', () => {
    expect(cn('text-heading', 'text-sm')).toBe('text-sm');
    expect(cn('text-sm', 'text-kbd')).toBe('text-kbd');
  });

  it('treats the new color tokens as colors', () => {
    expect(cn('text-progress-foreground', 'text-warning-foreground')).toBe(
      'text-warning-foreground',
    );
    expect(cn('bg-progress/10', 'text-progress-foreground')).toBe(
      'bg-progress/10 text-progress-foreground',
    );
  });
});
