import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DescriptionItem, DescriptionList } from './DescriptionList';

describe('DescriptionList', () => {
  it('pairs labels and values and shows an en dash for an empty value', () => {
    render(
      <TooltipProvider>
        <DescriptionList>
          <DescriptionItem label="Video ID" mono copy="abc123">
            abc123
          </DescriptionItem>
          <DescriptionItem label="Duration" />
        </DescriptionList>
      </TooltipProvider>,
    );
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    const values = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(terms).toEqual(['Video ID', 'Duration']);
    expect(values[1]).toBe('–');
    expect(screen.getByRole('button', { name: 'Copy video ID' })).toBeInTheDocument();
  });
});
