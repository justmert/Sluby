import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { STATUS, httpSpec, statusSpec } from './status';
import { AccessBadge, HttpStatusBadge, StatusBadge } from './StatusBadge';

describe('status mapping', () => {
  it('never uses warning for work under way', () => {
    for (const table of Object.values(STATUS)) {
      for (const spec of Object.values(table)) {
        if (spec.busy) expect(spec.tone === 'progress' || spec.tone === 'neutral').toBe(true);
      }
    }
  });

  it('labels every status in sentence case with no trailing period', () => {
    for (const table of Object.values(STATUS)) {
      for (const spec of Object.values(table)) {
        expect(spec.label).toMatch(/^[A-Z][^.]*$/);
        expect(spec.label.length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('shows an unknown status as itself instead of dropping it', () => {
    expect(statusSpec('asset', 'archived_soon')).toEqual({
      label: 'Archived soon',
      tone: 'neutral',
    });
  });

  it('colors http answers by class', () => {
    expect(httpSpec(204).tone).toBe('success');
    expect(httpSpec(404).tone).toBe('warning');
    expect(httpSpec(502).tone).toBe('danger');
    expect(httpSpec(null)).toMatchObject({ label: 'No response', tone: 'danger' });
  });
});

describe('StatusBadge', () => {
  it('renders the label and tone from the mapping', () => {
    renderWithMotion(<StatusBadge kind="asset" status="created" />);
    const badge = screen.getByText('Waiting for file').closest('[data-slot=badge]')!;
    expect(badge).toHaveAttribute('data-tone', 'neutral');
  });

  it('shows busy work as a pulsing dot in lists and a spinner when asked', () => {
    const { container, rerender } = renderWithMotion(
      <StatusBadge kind="asset" status="processing" />,
    );
    expect(container.querySelector('[data-slot=status-dot]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot=spinner]')).not.toBeInTheDocument();
    rerender(<StatusBadge kind="asset" status="processing" busy="spinner" />);
    expect(container.querySelector('[data-slot=spinner]')).toBeInTheDocument();
    expect(screen.getByText('Processing').closest('[data-slot=badge]')).toHaveAttribute(
      'data-variant',
      'progress',
    );
  });

  it('takes custom text while keeping the tone', () => {
    renderWithMotion(
      <StatusBadge kind="key" status="expiring">
        Expires in 2 hours
      </StatusBadge>,
    );
    expect(screen.getByText('Expires in 2 hours').closest('[data-slot=badge]')).toHaveAttribute(
      'data-tone',
      'warning',
    );
  });

  it('announces changes only when live', () => {
    const { container } = renderWithMotion(<StatusBadge kind="asset" status="ready" live />);
    expect(container.querySelector('[aria-live=polite]')).toBeInTheDocument();
  });
});

describe('AccessBadge and HttpStatusBadge', () => {
  it('draws nothing for public and a lock badge for private', () => {
    const { container, rerender } = renderWithMotion(<AccessBadge access="public" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AccessBadge access="private" />);
    expect(screen.getByText('Private').closest('[data-slot=badge]')).toHaveAttribute(
      'data-variant',
      'outline',
    );
  });

  it('shows the code', () => {
    renderWithMotion(<HttpStatusBadge code={500} />);
    expect(screen.getByText('500').closest('[data-slot=badge]')).toHaveAttribute(
      'data-variant',
      'destructive',
    );
  });
});
