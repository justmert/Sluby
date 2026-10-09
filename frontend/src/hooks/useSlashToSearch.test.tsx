import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { isTypingTarget, useSlashToSearch } from './useSlashToSearch';

function Page() {
  const search = useRef<HTMLInputElement>(null);
  useSlashToSearch(search);
  return (
    <>
      <input aria-label="Search" ref={search} defaultValue="old" />
      <input aria-label="Title" />
      <button type="button">Elsewhere</button>
    </>
  );
}

describe('useSlashToSearch', () => {
  it('focuses the search and selects what it holds', async () => {
    render(<Page />);
    screen.getByRole('button').focus();
    await userEvent.keyboard('/');
    const search = screen.getByRole('textbox', { name: 'Search' });
    expect(search).toHaveFocus();
    expect(search).toHaveValue('old');
    expect((search as HTMLInputElement).selectionStart).toBe(0);
    expect((search as HTMLInputElement).selectionEnd).toBe(3);
  });

  it('types a slash into another field instead of jumping', async () => {
    render(<Page />);
    const title = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.type(title, 'a/b');
    expect(title).toHaveFocus();
    expect(title).toHaveValue('a/b');
  });

  it('ignores the key with a modifier', async () => {
    render(<Page />);
    screen.getByRole('button').focus();
    await userEvent.keyboard('{Control>}/{/Control}');
    expect(screen.getByRole('button')).toHaveFocus();
  });

  it('knows fields that take typing', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
