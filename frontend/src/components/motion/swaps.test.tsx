import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { Collapse } from './Collapse';
import { FadeSwap } from './FadeSwap';
import { StatusTransition } from './StatusTransition';

describe('FadeSwap', () => {
  it('replaces the old state with the new one', async () => {
    const { rerender } = renderWithMotion(<FadeSwap swapKey="loading">loading</FadeSwap>);
    expect(screen.getByText('loading')).toBeVisible();
    rerender(<FadeSwap swapKey="ready">ready</FadeSwap>);
    await waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument());
    expect(screen.getByText('ready')).toBeVisible();
  });
});

describe('Collapse', () => {
  it('mounts content when opened and drops it when closed', async () => {
    const { rerender } = renderWithMotion(<Collapse open={false}>details</Collapse>);
    expect(screen.queryByText('details')).not.toBeInTheDocument();
    rerender(<Collapse open>details</Collapse>);
    await waitFor(() => expect(screen.getByText('details')).toBeVisible());
    rerender(<Collapse open={false}>details</Collapse>);
    await waitFor(() => expect(screen.queryByText('details')).not.toBeInTheDocument());
  });
});

describe('StatusTransition', () => {
  it('swaps the badge and pulses only in-progress states', async () => {
    const { rerender } = renderWithMotion(
      <StatusTransition status="processing" pulse live>
        Processing
      </StatusTransition>,
    );
    expect(screen.getByText('Processing')).toHaveAttribute('data-pulse');
    rerender(
      <StatusTransition status="ready" live>
        Ready
      </StatusTransition>,
    );
    await waitFor(() => expect(screen.queryByText('Processing')).not.toBeInTheDocument());
    const ready = screen.getByText('Ready');
    expect(ready).not.toHaveAttribute('data-pulse');
    expect(ready.parentElement).toHaveAttribute('aria-live', 'polite');
  });
});
