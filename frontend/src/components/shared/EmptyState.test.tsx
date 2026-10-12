import { render, screen } from '@testing-library/react';
import { KeyRound } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows the title, one sentence and the action', () => {
    render(
      <EmptyState
        icon={KeyRound}
        title="No API keys yet"
        description="Create a key to use the API or SDK from your server."
        action={<button>Create key</button>}
        secondaryAction={<a href="/docs">Read the docs</a>}
      />,
    );
    expect(screen.getByText('No API keys yet')).toHaveClass('text-lg/7', 'font-semibold');
    expect(screen.getByText(/Create a key to use/)).toBeInTheDocument();
    const order = [...document.querySelectorAll('a, button')].map((e) => e.textContent);
    expect(order).toEqual(['Read the docs', 'Create key']);
  });
});
