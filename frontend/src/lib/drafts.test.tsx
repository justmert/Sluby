import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WithSession } from '@/test/session';
import { RESTORED_DRAFT_MESSAGE, usePersistedDraft } from './drafts';
import { reportUnauthorized } from './session-events';

function Form({ storageKey = 'create-key' }: { storageKey?: string }) {
  const [name, setName] = useState('');
  usePersistedDraft(storageKey, name ? { name } : null, (draft) => setName(draft.name));
  return <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />;
}

const renderAs = (id = 'acct-1', storageKey?: string) =>
  render(
    <WithSession id={id}>
      <Form storageKey={storageKey} />
    </WithSession>,
  );

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('usePersistedDraft', () => {
  it('keeps what was typed when the session ends and restores it after sign-in', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue(1);
    const first = renderAs();
    await userEvent.type(screen.getByLabelText('Name'), 'production');
    act(() => reportUnauthorized());
    first.unmount();

    renderAs();
    expect(screen.getByLabelText('Name')).toHaveValue('production');
    expect(success).toHaveBeenCalledWith(RESTORED_DRAFT_MESSAGE, { duration: 4_000 });
    // once only
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps nothing when there is nothing typed', () => {
    const first = renderAs();
    act(() => reportUnauthorized());
    first.unmount();
    expect(sessionStorage.length).toBe(0);
  });

  it('never restores another account’s draft', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue(1);
    const first = renderAs('acct-1');
    await userEvent.type(screen.getByLabelText('Name'), 'secret plans');
    act(() => reportUnauthorized());
    first.unmount();

    renderAs('acct-2');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(success).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps each form under its own key', async () => {
    const first = renderAs('acct-1', 'add-webhook');
    await userEvent.type(screen.getByLabelText('Name'), 'hook');
    act(() => reportUnauthorized());
    first.unmount();

    const other = renderAs('acct-1', 'create-key');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    other.unmount();
    renderAs('acct-1', 'add-webhook');
    expect(screen.getByLabelText('Name')).toHaveValue('hook');
  });

  it('carries on without storage', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAs();
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    expect(() => act(() => reportUnauthorized())).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
