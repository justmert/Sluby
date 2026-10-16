import { render, screen } from '@testing-library/react';
import { CircleAlert, KeyRound } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows the title, one sentence and the action, primary first as in the design', () => {
    render(
      <EmptyState
        icon={KeyRound}
        title="No API keys yet"
        description="Create a key to use the API or SDK from your server."
        action={<button>Create key</button>}
        secondaryAction={<a href="/docs">Read the docs</a>}
      />,
    );
    expect(screen.getByText('No API keys yet')).toHaveClass('text-lg/7', 'font-bold');
    expect(screen.getByText(/Create a key to use/)).toBeInTheDocument();
    const order = [...document.querySelectorAll('a, button')].map((e) => e.textContent);
    expect(order).toEqual(['Create key', 'Read the docs']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is an alert with a red icon tile in the error tone', () => {
    render(
      <EmptyState
        icon={CircleAlert}
        tone="error"
        title="Could not load videos"
        description="The server did not answer. Your videos are safe on Sia."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load videos');
    expect(alert.querySelector('[data-slot=empty-icon]')).toHaveClass(
      'border-destructive-line',
      'text-destructive',
    );
  });
});
