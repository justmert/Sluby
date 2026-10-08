import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { renderWithMotion } from '@/test/render';
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
});
