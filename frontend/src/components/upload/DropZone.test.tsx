import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { DropZone } from './DropZone';

afterEach(() => vi.restoreAllMocks());

describe('DropZone', () => {
  it('opens the file picker once per press, from the button or the box', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    renderWithMotion(<DropZone onFiles={() => {}} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /choose files/i }));
    expect(click).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByText(/MP4, MOV/));
    expect(click).toHaveBeenCalledTimes(2);
  });
});
