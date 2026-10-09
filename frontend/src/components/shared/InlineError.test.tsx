import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { renderWithMotion } from '@/test/render';
import { InlineError } from './InlineError';
import { PageState } from './PageState';

describe('InlineError', () => {
  it('renders nothing without an error', () => {
    const { container } = renderWithMotion(<InlineError error={null} what="your API keys" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says what failed and what to do, never the raw status line', () => {
    renderWithMotion(
      <InlineError error={new ApiError(502, 'HTTP 502')} what="your API keys" onRetry={() => {}} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load your API keys');
    expect(alert).toHaveTextContent('The server ran into a problem (error 502).');
    // the raw text is only under Details
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('HTTP 502').closest('details')).not.toHaveAttribute('open');
  });

  it('offers Try again only when retrying can help', async () => {
    const retry = vi.fn();
    const { rerender } = renderWithMotion(
      <InlineError error={new TypeError('Failed to fetch')} what="x" onRetry={retry} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<InlineError error={new ApiError(404, 'gone')} what="x" onRetry={retry} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows a busy button while retrying', () => {
    renderWithMotion(
      <InlineError error={new ApiError(500, 'x')} what="x" onRetry={() => {}} retrying />,
    );
    expect(screen.getByRole('button', { name: /Trying again/ })).toBeDisabled();
  });
});

describe('PageState', () => {
  it('fills its words from the error and adds Try again last', () => {
    renderWithMotion(
      <PageState
        title="Could not load this video"
        error={new ApiError(503, 'Service Unavailable')}
        onRetry={() => {}}
        actions={<a href="/studio/videos">Back to videos</a>}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Could not load this video' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/The server ran into a problem \(error 503\)/)).toBeInTheDocument();
    const controls = screen.getAllByRole('link').concat(screen.getAllByRole('button'));
    expect(controls.map((c) => c.textContent)).toEqual(['Back to videos', 'Try again']);
  });
});
