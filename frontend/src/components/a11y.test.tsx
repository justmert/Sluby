import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { Logo } from '@/components/brand/Logo';
import { Progress } from '@/components/ui/progress';

describe('shared component accessibility', () => {
  it('gives a progress bar its value', () => {
    render(<Progress value={42} aria-label="Upload progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Upload progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('keeps the logo letter out of link and heading names', () => {
    render(
      <a href="/studio">
        <Logo />
        Sluby
      </a>,
    );
    expect(screen.getByRole('link')).toHaveAccessibleName('Sluby');
  });

  it('treats a thumbnail beside its title as decorative', () => {
    const { container } = render(<AssetThumbnail thumbnailObjectIds={['obj1']} />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});
