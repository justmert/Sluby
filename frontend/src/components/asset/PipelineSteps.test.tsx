import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { PipelineSteps } from './PipelineSteps';

const items = () =>
  within(screen.getByRole('list', { name: 'Processing steps' })).getAllByRole('listitem');

describe('PipelineSteps', () => {
  it('breaks a step label that is wider than its column at 320 instead of running into the next', () => {
    renderWithMotion(<PipelineSteps steps={['done', 'active', 'pending', 'pending']} />);
    const label = screen.getByText('Transcode').closest('li')!.lastElementChild!;
    expect(label).toHaveClass('hyphens-auto', 'wrap-break-word');
  });

  it('names every step with where it stands', () => {
    renderWithMotion(<PipelineSteps steps={['done', 'active', 'pending', 'pending']} />);
    expect(items().map((li) => li.textContent)).toEqual([
      'Upload, done',
      'Transcode, in progress',
      'Store on Sia, not started',
      'Publish, not started',
    ]);
  });

  it('marks only the running step as the current one', () => {
    renderWithMotion(<PipelineSteps steps={['done', 'done', 'active', 'pending']} />);
    const current = items().filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Store on Sia');
  });

  it('has no current step when nothing runs', () => {
    renderWithMotion(<PipelineSteps steps={['done', 'waiting', 'pending', 'pending']} />);
    expect(items().some((li) => li.hasAttribute('aria-current'))).toBe(false);
    expect(items()[1]).toHaveTextContent('Transcode, waiting to start');
  });

  it('fills done and failed rings so they never read as empty radios (VIS-25)', () => {
    renderWithMotion(<PipelineSteps steps={['done', 'failed', 'pending', 'pending']} />);
    const ring = (i: number) => items()[i].querySelector('.rounded-full')!;
    expect(ring(0).className).toContain('bg-success');
    expect(ring(1).className).toContain('bg-destructive-solid');
    expect(items()[1]).toHaveTextContent('Transcode, failed');
  });

  it('shows no step notes beside the names (CPY-32)', () => {
    renderWithMotion(
      <PipelineSteps steps={['paused', 'pending', 'pending', 'pending']} orientation="vertical" />,
    );
    expect(items()[0].textContent).toBe('Upload, paused');
  });

  it('explains each step only when asked, in the vertical layout', () => {
    const { rerender } = renderWithMotion(
      <PipelineSteps steps={['active', 'pending', 'pending', 'pending']} orientation="vertical" />,
    );
    expect(screen.queryByText('The video becomes playable')).toBeNull();
    rerender(
      <PipelineSteps
        steps={['active', 'pending', 'pending', 'pending']}
        orientation="vertical"
        details
      />,
    );
    expect(screen.getByText('The video becomes playable')).toBeInTheDocument();
    expect(screen.getByText('Converted into several qualities for streaming')).toBeInTheDocument();
  });

  it('draws a rail between steps that fills once a step is done', () => {
    const { container } = renderWithMotion(
      <PipelineSteps steps={['done', 'active', 'pending', 'pending']} />,
    );
    const rails = container.querySelectorAll('[data-slot="pipeline-rail"]');
    expect(rails).toHaveLength(3);
    expect(rails[0].firstElementChild!.className).toContain('scale-x-100');
    expect(rails[1].firstElementChild!.className).toContain('scale-x-0');
  });

  it('uses 12 px labels at size sm', () => {
    renderWithMotion(
      <PipelineSteps steps={['active', 'pending', 'pending', 'pending']} size="sm" />,
    );
    expect(screen.getByText('Upload').className).toContain('text-xs');
  });
});
