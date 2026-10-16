import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LOGO_PATH, Logo } from './Logo';

describe('Logo', () => {
  it('draws the same mark as the favicon', () => {
    const favicon = readFileSync(path.resolve(__dirname, '../../../public/favicon.svg'), 'utf8');
    expect(favicon).toContain(`d="${LOGO_PATH}"`);
  });

  it('is decorative and does not follow the theme primary', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('rect')).toHaveClass('fill-brand');
    expect(container.innerHTML).not.toMatch(/primary/);
  });
});
