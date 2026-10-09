import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssetThumbnail } from './AssetThumbnail';

describe('AssetThumbnail', () => {
  it('shows the stage and a thin bar instead of an empty box while processing (VIS-31)', () => {
    const { container } = render(
      <AssetThumbnail
        size="md"
        thumbnailObjectIds={['t1']}
        processing={{ label: 'Storing on Sia, 65%', percent: 65 }}
      />,
    );
    expect(screen.getByText('Storing on Sia, 65%')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="progress"]')).toHaveClass('h-0.5');
    expect(container.querySelector('img')).toBeNull();
    // the stripes only move when motion is welcome
    expect(container.querySelector('.motion-safe\\:animate-stripes')).not.toBeNull();
  });

  it('keeps the list size to icons', () => {
    render(
      <AssetThumbnail
        thumbnailObjectIds={[]}
        processing={{ label: 'Transcoding, 5%', percent: 5 }}
      />,
    );
    expect(screen.queryByText('Transcoding, 5%')).not.toBeInTheDocument();
  });

  it('tints a failed video and says so in the grid size', () => {
    const { container } = render(<AssetThumbnail size="md" thumbnailObjectIds={['t1']} failed />);
    expect(container.firstElementChild).toHaveClass('bg-destructive/10');
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('puts the private lock in a corner chip in the grid, and alone in a list', () => {
    const { container, rerender } = render(
      <AssetThumbnail size="md" thumbnailObjectIds={['t1']} isPrivate />,
    );
    expect(screen.getByLabelText('Private video, no preview').closest('span')).toHaveClass(
      'absolute',
    );
    expect(container.querySelector('img')).toBeNull();
    rerender(<AssetThumbnail thumbnailObjectIds={['t1']} isPrivate />);
    expect(screen.getByLabelText('Private video, no preview').parentElement).toBe(
      container.firstElementChild,
    );
  });
});
