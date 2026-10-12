import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { video } from './test-assets';
import { videoActions } from './video-actions';
import { VideoRowMenu } from './VideoRowMenu';

describe('VideoRowMenu and videoActions', () => {
  it('lists the actions with icons, the destructive one last after a separator', async () => {
    const on = { open: vi.fn(), preview: vi.fn(), delete: vi.fn() };
    const a = video('a1', 'Walkthrough');
    renderPage(<VideoRowMenu actions={videoActions(a, on)} title={a.title} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Walkthrough' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Copy embed code',
      'Open',
      'Preview',
      'Copy stream URL',
      'Copy video ID',
      'Delete',
    ]);
    expect(items.every((i) => i.querySelector('svg'))).toBe(true);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Preview' }));
    expect(on.preview).toHaveBeenCalledWith(a);
  });

  it('copies a stream url that plays a public video, and the signing code for a private one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const on = { open: vi.fn(), preview: vi.fn(), delete: vi.fn() };
    const pub = videoActions(video('a1', 'Walkthrough'), on);
    pub.find((x) => x.label === 'Copy stream URL')!.onSelect();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/v1/stream/a1/master.m3u8`),
    );
    const priv = videoActions(video('p1', 'Secret', { accessTier: 'private' }), on);
    expect(priv.map((x) => x.label)).not.toContain('Copy stream URL');
    priv.find((x) => x.label === 'Copy embed code')!.onSelect();
    await vi.waitFor(() => expect(writeText.mock.lastCall![0]).toContain('getSignedUrl'));
  });
});
