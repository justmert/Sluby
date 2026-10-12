import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Input } from './input';
import { Toggle } from './toggle';

// a touch screen gets bigger targets from the primitives themselves, so no
// page needs its own pointer-coarse sizes (A11Y-47)
describe('coarse pointer sizes', () => {
  it.each([
    ['default', 'pointer-coarse:h-10'],
    ['sm', 'pointer-coarse:h-9'],
    ['lg', 'pointer-coarse:h-11'],
    ['icon', 'pointer-coarse:size-11'],
    ['icon-sm', 'pointer-coarse:size-10'],
    ['icon-xs', 'pointer-coarse:size-9'],
  ] as const)('button %s grows to %s', (size, cls) => {
    render(<Button size={size}>x</Button>);
    expect(screen.getByRole('button')).toHaveClass(cls);
  });

  it('keeps the coarse step when a page sets its own size', () => {
    render(
      <Button size="icon" className="size-7">
        x
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveClass('size-7', 'pointer-coarse:size-11');
  });

  it('grows inputs, toggles and the checkbox hit area', () => {
    render(
      <>
        <Input aria-label="name" />
        <Toggle aria-label="bold">B</Toggle>
        <Checkbox aria-label="pick" />
      </>,
    );
    // the design's field is already 40px, a finger's size, everywhere
    expect(screen.getByRole('textbox')).toHaveClass('h-10');
    expect(screen.getByRole('button', { name: 'bold' })).toHaveClass('pointer-coarse:h-10');
    expect(screen.getByRole('checkbox')).toHaveClass('pointer-coarse:after:-inset-3.5');
  });
});
