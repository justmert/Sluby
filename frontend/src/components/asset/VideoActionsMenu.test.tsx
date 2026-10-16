import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { VideoActionsMenu } from './VideoActionsMenu';

describe('VideoActionsMenu', () => {
  it('copies the video ID and the stream URL, and keeps Delete last in red', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onDelete = vi.fn();
    renderPage(<VideoActionsMenu asset={{ id: 'a1', status: 'ready' }} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Copy video ID',
      'Copy stream URL',
      'Delete video',
    ]);
    expect(items[2]).toHaveAttribute('data-variant', 'destructive');

    await userEvent.click(items[0]);
    expect(writeText).toHaveBeenLastCalledWith('a1');
    expect(await screen.findByText('Video ID copied')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy stream URL' }));
    expect(writeText).toHaveBeenLastCalledWith(
      `${window.location.origin}/v1/stream/a1/master.m3u8`,
    );

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete video' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('has no stream URL before the video is ready', async () => {
    renderPage(<VideoActionsMenu asset={{ id: 'a1', status: 'processing' }} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await screen.findByRole('menuitem', { name: 'Copy video ID' });
    expect(screen.queryByRole('menuitem', { name: 'Copy stream URL' })).toBeNull();
  });

  it('says when the browser blocks the clipboard', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderPage(<VideoActionsMenu asset={{ id: 'a1', status: 'ready' }} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy video ID' }));
    expect(
      await screen.findByText('Could not copy. Your browser blocked the clipboard'),
    ).toBeInTheDocument();
  });
});
