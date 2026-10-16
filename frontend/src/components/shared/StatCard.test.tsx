import { screen } from '@testing-library/react';
import { Film } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { TooltipProvider } from '@/components/ui/tooltip';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('wraps a long label to two lines instead of cutting it on a narrow card', () => {
    renderWithMotion(<StatCard icon={Film} label="Streamed by this server" value={3} />);
    const label = screen.getByText('Streamed by this server');
    expect(label).toHaveClass('line-clamp-2');
    expect(label).not.toHaveClass('truncate');
    // the icon stays beside the first line
    expect(label.parentElement).toHaveClass('items-start');
  });

  it('shows an en dash with its reason when there is no figure', () => {
    renderWithMotion(
      <TooltipProvider>
        <StatCard icon={Film} label="Plays" value={null} emptyReason="Not counted" />
      </TooltipProvider>,
    );
    expect(screen.getByLabelText('–, Not counted')).toBeInTheDocument();
  });
});
