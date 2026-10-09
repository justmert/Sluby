import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { renderWithMotion } from '@/test/render';
import { WithSession } from '@/test/session';
import { reportUnauthorized } from '@/lib/session-events';
import { InlineEditField } from './InlineEditField';

describe('InlineEditField', () => {
  it('saves on Enter and shows the new value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithMotion(<InlineEditField label="title" value="Old" onSave={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const input = screen.getByRole('textbox', { name: 'Edit title' });
    await userEvent.clear(input);
    await userEvent.type(input, 'New title{Enter}');
    expect(onSave).toHaveBeenCalledWith('New title');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit title' })).toHaveTextContent('New title'),
    );
  });

  it('cancels on Escape without saving', async () => {
    const onSave = vi.fn();
    renderWithMotion(<InlineEditField label="title" value="Old" onSave={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.type(screen.getByRole('textbox'), 'zzz{Escape}');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveTextContent('Old');
  });

  it('refuses an empty required value', async () => {
    const onSave = vi.fn();
    renderWithMotion(
      <InlineEditField
        label="title"
        value="Old"
        onSave={onSave}
        requiredMessage="Enter a title."
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a title.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('brings the field back with the error and the typed text when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new ApiError(500, 'Internal Server Error'));
    renderWithMotion(<InlineEditField label="title" value="Old" onSave={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'Kept{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('The server ran into a problem');
    expect(screen.getByRole('textbox')).toHaveValue('Kept');
  });

  it('tells the page when editing starts', async () => {
    const onEditStart = vi.fn();
    renderWithMotion(
      <InlineEditField label="title" value="Old" onSave={vi.fn()} onEditStart={onEditStart} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    expect(onEditStart).toHaveBeenCalledOnce();
  });

  it('lets the page render the value, with its own edit button, so a heading keeps its name', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithMotion(
      <InlineEditField
        label="title"
        value="Product walkthrough"
        onSave={onSave}
        display={(shown) => <h1>{shown}</h1>}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Product walkthrough' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit title' }), ' 2{Enter}');
    expect(onSave).toHaveBeenCalledWith('Product walkthrough 2');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Product walkthrough 2'),
    );
    // back on the control that opened the field
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit title' })).toHaveFocus());
  });

  it('returns focus to the value after Escape', async () => {
    renderWithMotion(<InlineEditField label="title" value="Old" onSave={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveFocus();
  });

  it('lets the page render a save error with its own action, keeping the text', async () => {
    const onSave = vi.fn().mockRejectedValue(new ApiError(412, 'changed'));
    renderWithMotion(
      <InlineEditField
        label="title"
        value="Old"
        onSave={onSave}
        renderError={() => (
          <>
            Changed elsewhere. <button type="button">Reload</button>
          </>
        )}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'Mine{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Changed elsewhere.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Mine');
    // pressing the error's own button is not leaving the field, so nothing saves again
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('Mine');
  });

  it('puts focus back in the field when the error settles into a note', async () => {
    const onSave = vi.fn().mockRejectedValue(new ApiError(412, 'changed'));
    renderWithMotion(
      <InlineEditField
        label="title"
        value="Old"
        onSave={onSave}
        renderError={(_err, { settle }) => (
          <button type="button" onClick={() => settle('Reloaded.')}>
            Reload
          </button>
        )}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.type(screen.getByRole('textbox'), ' and mine{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(screen.getByText('Reloaded.')).toBeInTheDocument();
    // the button that had focus is gone; the field takes it, not the page
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('counts characters once the text nears the limit', async () => {
    renderWithMotion(
      <InlineEditField
        label="description"
        value={'x'.repeat(10)}
        onSave={vi.fn()}
        multiline
        maxLength={20}
        counterFrom={12}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    expect(screen.queryByText(/of 20/)).toBeNull();
    await userEvent.type(screen.getByRole('textbox'), 'yy');
    expect(screen.getByText('12 of 20')).toBeInTheDocument();
  });
});

describe('InlineEditField long text', () => {
  it('scrolls a long description inside a capped box instead of growing past the screen', async () => {
    renderWithMotion(
      <InlineEditField
        label="description"
        value={'line\n'.repeat(400)}
        onSave={vi.fn()}
        multiline
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    expect(screen.getByRole('textbox')).toHaveClass('max-h-[60vh]', 'overflow-y-auto');
  });
});

describe('InlineEditField drafts (FLW-15)', () => {
  const field = (onSave = vi.fn()) => (
    <WithSession>
      <InlineEditField
        label="description"
        value="Old"
        multiline
        draftKey="video-description:a1"
        onSave={onSave}
      />
    </WithSession>
  );

  it('keeps text that was being saved when the session ended and reopens it after sign-in', async () => {
    sessionStorage.clear();
    // the save is the call that comes back 401
    const onSave = vi.fn(() => {
      reportUnauthorized('revoked');
      return new Promise(() => {});
    });
    const first = renderWithMotion(field(onSave));
    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    const box = screen.getByRole('textbox', { name: 'Edit description' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Typed before the session ended{Control>}{Enter}{/Control}');
    expect(onSave).toHaveBeenCalled();
    first.unmount();

    renderWithMotion(field());
    expect(await screen.findByRole('textbox', { name: 'Edit description' })).toHaveValue(
      'Typed before the session ended',
    );
  });

  it('keeps nothing when the field was not being edited', () => {
    sessionStorage.clear();
    const first = renderWithMotion(field());
    act(() => reportUnauthorized('revoked'));
    first.unmount();
    expect(sessionStorage.length).toBe(0);
  });
});
