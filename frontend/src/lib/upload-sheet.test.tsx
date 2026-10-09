import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { onPendingFiles, takePendingFiles, useUploadSheet } from './upload-sheet';

function Probe() {
  const sheet = useUploadSheet();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="where">{location.pathname + location.search + location.hash}</p>
      <p data-testid="open">{String(sheet.isOpen)}</p>
      <button onClick={() => sheet.open()}>open</button>
      <button onClick={() => sheet.open([new File(['a'], 'a.mp4'), new File(['b'], 'b.mp4')])}>
        drop
      </button>
      <button onClick={() => sheet.close()}>close</button>
      <button onClick={() => void navigate(-1)}>back</button>
    </>
  );
}

const renderAt = (entries: string[]) =>
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Probe />
    </MemoryRouter>,
  );

const where = () => screen.getByTestId('where').textContent;
const isOpen = () => screen.getByTestId('open').textContent === 'true';

afterEach(() => {
  takePendingFiles();
});

describe('useUploadSheet', () => {
  it('reads ?upload=1 on any route', () => {
    renderAt(['/studio/settings?upload=1']);
    expect(isOpen()).toBe(true);
  });

  it('opens on the current route, keeping its params and hash', async () => {
    renderAt(['/studio/videos?status=ready#top']);
    expect(isOpen()).toBe(false);
    await userEvent.click(screen.getByText('open'));
    expect(where()).toBe('/studio/videos?status=ready&upload=1#top');
    expect(isOpen()).toBe(true);
  });

  it('closes by going back over the entry it opened, so Back does not reopen it', async () => {
    renderAt(['/studio', '/studio/videos?q=a']);
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByText('close'));
    expect(where()).toBe('/studio/videos?q=a');
    expect(isOpen()).toBe(false);
    // the entry before the page, not the sheet again
    await userEvent.click(screen.getByText('back'));
    expect(where()).toBe('/studio');
  });

  it('lets Back close a sheet it opened', async () => {
    renderAt(['/studio/videos']);
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByText('back'));
    expect(where()).toBe('/studio/videos');
    expect(isOpen()).toBe(false);
  });

  it('closes a sheet that arrived open by dropping the param in place', async () => {
    renderAt(['/studio', '/studio/videos?view=grid&upload=1']);
    await userEvent.click(screen.getByText('close'));
    expect(where()).toBe('/studio/videos?view=grid');
    // replaced, not pushed: Back leaves the page
    await userEvent.click(screen.getByText('back'));
    expect(where()).toBe('/studio');
  });

  it('parks dropped files until the sheet takes them, once', async () => {
    renderAt(['/studio/videos']);
    const listener = vi.fn();
    const off = onPendingFiles(listener);
    await userEvent.click(screen.getByText('drop'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takePendingFiles().map((f) => f.name)).toEqual(['a.mp4', 'b.mp4']);
    expect(takePendingFiles()).toEqual([]);
    off();
  });

  it('adds files to an open sheet without another history entry', async () => {
    renderAt(['/studio', '/studio/videos']);
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByText('drop'));
    expect(takePendingFiles()).toHaveLength(2);
    await act(async () => {
      await userEvent.click(screen.getByText('close'));
    });
    expect(where()).toBe('/studio/videos');
    await userEvent.click(screen.getByText('back'));
    expect(where()).toBe('/studio');
  });
});
