import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

const LONG =
  'Quarterly all-hands recording with the full engineering, design and operations teams, extended cut including Q&A';

describe('SelectItem', () => {
  it('lets a long text option shrink and end in an ellipsis', () => {
    render(
      <Select open value="a">
        <SelectTrigger aria-label="Video">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">{LONG}</SelectItem>
        </SelectContent>
      </Select>,
    );
    const option = screen.getByRole('option', { name: LONG });
    // the text wrapper is a flex span, which only shrinks below its text with min-w-0
    expect(option).toHaveClass('*:[span]:last:min-w-0');
    expect(within(option).getByText(LONG)).toHaveClass('truncate');
  });
});
