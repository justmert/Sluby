import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { SecretRevealDialog, type RevealedSecret } from './SecretRevealDialog';

const secret: RevealedSecret = {
  title: 'API key created',
  description: 'Copy “CI” now. You will not be able to see it again.',
  value: 'sluby_Secret123',
  label: 'API key',
  envName: 'SLUBY_API_KEY',
  note: 'The old key stops working now.',
};

function Harness() {
  const [shown, setShown] = useState<RevealedSecret | null>(secret);
  return (
    <>
      <p>{shown ? 'open' : 'closed'}</p>
      <SecretRevealDialog secret={shown} onClose={() => setShown(null)} />
    </>
  );
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('SecretRevealDialog', () => {
  it('shows the value, an export line and the note', () => {
    renderWithMotion(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'API key created' });
    expect(dialog).toHaveAccessibleDescription(secret.description as string);
    expect(within(dialog).getByText('sluby_Secret123')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('export SLUBY_API_KEY=sluby_Secret123');
    expect(dialog).toHaveTextContent('The old key stops working now.');
  });

  it('holds on Escape and outside clicks until copied, with no close button (FLW-50)', async () => {
    renderWithMotion(<Harness />);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('open', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy API key as an environment variable' }),
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByText('closed', { selector: 'p' })).toBeInTheDocument());
  });

  it('closes on I copied it at any time', async () => {
    renderWithMotion(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'I copied it' }));
    await waitFor(() => expect(screen.getByText('closed', { selector: 'p' })).toBeInTheDocument());
  });
});
