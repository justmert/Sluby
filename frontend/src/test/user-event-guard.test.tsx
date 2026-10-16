import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { endUserEvents, OutlivedTest } from './user-event-guard';

// what the shared setup does after every test, run by hand mid-test so a
// test can watch it: typing left running stops and types nowhere else
describe('user-event guard', () => {
  it('stops typing a test left running, so the keys never reach the next one', async () => {
    render(<input aria-label="first" />);
    const first = screen.getByRole('textbox', { name: 'first' });
    const typing = userEvent.type(first, 'x'.repeat(2000));
    await vi.waitFor(() => expect((first as HTMLInputElement).value.length).toBeGreaterThan(0));

    await act(() => endUserEvents());
    await expect(typing).rejects.toBeInstanceOf(OutlivedTest);
    const typed = (first as HTMLInputElement).value.length;
    expect(typed).toBeLessThan(2000);

    render(<input aria-label="second" />);
    const second = screen.getByRole('textbox', { name: 'second' });
    act(() => second.focus());
    await new Promise((r) => setTimeout(r, 100));
    expect(second).toHaveValue('');
    expect((first as HTMLInputElement).value).toHaveLength(typed);
  });

  it('stops a call that waits on a fake timer nobody will advance', async () => {
    vi.useFakeTimers();
    render(<input aria-label="field" />);
    const typing = userEvent.type(screen.getByRole('textbox', { name: 'field' }), 'abc');
    await act(() => endUserEvents());
    await expect(typing).rejects.toBeInstanceOf(OutlivedTest);
  });

  it('stops calls of a setup instance and of its sub instances', async () => {
    const user = userEvent.setup();
    const sub = user.setup({ skipHover: true });
    render(<input aria-label="field" />);
    const field = screen.getByRole('textbox', { name: 'field' });
    const a = user.type(field, 'y'.repeat(2000));
    const b = sub.keyboard('z'.repeat(2000));
    await act(() => endUserEvents());
    await expect(a).rejects.toBeInstanceOf(OutlivedTest);
    await expect(b).rejects.toBeInstanceOf(OutlivedTest);
  });

  it('stops a findBy the test left waiting before it can act on the next page', async () => {
    const waiting = screen.findByText('only on the next page');
    await act(() => endUserEvents());
    render(<p>only on the next page</p>);
    await expect(waiting).rejects.toBeInstanceOf(OutlivedTest);
  });

  it('leaves a call that finishes in its test alone', async () => {
    render(<input aria-label="field" />);
    const field = screen.getByRole('textbox', { name: 'field' });
    await userEvent.type(field, 'done');
    expect(field).toHaveValue('done');
  });
});
