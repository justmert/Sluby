import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '@sluby/sdk';
import { renderPage } from '@/test/render';
import { video } from './test-assets';
import { videoActions } from './video-actions';
import { VideosGrid } from './VideosGrid';

function Harness({ assets }: { assets: VideoAsset[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <VideosGrid
      assets={assets}
      selected={selected}
      onSelectedChange={setSelected}
      actions={(a) => videoActions(a, { open: vi.fn(), preview: vi.fn(), delete: vi.fn() })}
      staggerIn={false}
      busy={false}
    />
  );
}

describe('VideosGrid', () => {
  it('fills a selected tile like a selected row and backs its checkbox with a 32px target', async () => {
    renderPage(<Harness assets={[video('a1', 'Walkthrough')]} />);
    const box = screen.getByRole('checkbox', { name: 'Select Walkthrough' });
    const target = box.closest('[data-slot="select-target"]')!;
    expect(target).toHaveClass('size-8', 'bg-card');
    await userEvent.click(box);
    const card = box.closest('[data-state="selected"]')!;
    expect(card).toHaveClass('bg-muted', 'border-border-strong');
  });

  it('edges a failed tile in red and marks a private one in a corner chip', () => {
    renderPage(
      <Harness
        assets={[
          video('f1', 'Broken', { status: 'failed' }),
          video('p1', 'Secret', { accessTier: 'private', thumbnailObjectIds: ['t1'] }),
        ]}
      />,
    );
    expect(document.querySelector('[data-state="failed"]')).toHaveClass('border-destructive/40');
    expect(screen.getByLabelText('Private video, no preview')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('wraps titles to two lines and keeps their direction', () => {
    renderPage(<Harness assets={[video('a1', 'تسجيل الاجتماع')]} />);
    const title = screen.getByRole('link', { name: 'تسجيل الاجتماع' });
    expect(title).toHaveAttribute('dir', 'auto');
    expect(title).toHaveClass('line-clamp-2');
  });
});
