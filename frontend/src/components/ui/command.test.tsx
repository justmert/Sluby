import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';

describe('CommandDialog', () => {
  it('filters items as you type and runs the picked one', async () => {
    const picked: string[] = [];
    render(
      <CommandDialog open title="Go to" description="Jump to a page">
        {/* CommandDialog renders its children as is; cmdk needs the Command root */}
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandEmpty>Nothing found</CommandEmpty>
            <CommandGroup heading="Pages">
              <CommandItem onSelect={() => picked.push('assets')}>Assets</CommandItem>
              <CommandItem onSelect={() => picked.push('settings')}>Settings</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Go to' })).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Search'), 'ings');
    // cmdk matches fuzzily, so the query has letters "Assets" lacks
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: 'Assets' })).not.toBeInTheDocument(),
    );
    await userEvent.keyboard('{Enter}');
    expect(picked).toEqual(['settings']);
  });
});
