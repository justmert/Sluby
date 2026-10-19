import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PipelineProgress } from './PipelineProgress';
import { stepFill } from './pipeline-states';

const widths = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-slot="pipeline-fill"]')).map(
    (el) => el.style.width,
  );

describe('stepFill', () => {
  it('splits the job percent over the server steps as the pipeline reports it', () => {
    // transcoding runs to 65, storing on sia to 90, publishing to 100
    expect(stepFill(1, 'active', { percent: 32.5 })).toBe(0.5);
    expect(stepFill(2, 'active', { percent: 77.5 })).toBe(0.5);
    expect(stepFill(3, 'active', { percent: 95 })).toBe(0.5);
    expect(stepFill(2, 'active', { percent: 40 })).toBe(0);
    expect(stepFill(1, 'active', { percent: 80 })).toBe(1);
  });

  it('fills the upload from its own percent', () => {
    expect(stepFill(0, 'active', { upload: 25 })).toBe(0.25);
    expect(stepFill(0, 'paused', { upload: 60 })).toBe(0.6);
  });

  it('fills done and failed steps and leaves the rest empty', () => {
    expect(stepFill(1, 'done', {})).toBe(1);
    expect(stepFill(2, 'failed', { percent: 70 })).toBe(1);
    expect(stepFill(3, 'pending', { percent: 99 })).toBe(0);
    expect(stepFill(1, 'skipped', {})).toBe(0);
  });
});

describe('PipelineProgress', () => {
  it('draws one bar in four parts with each step filled as far as it got', () => {
    render(
      <PipelineProgress
        steps={['done', 'done', 'active', 'pending']}
        percent={77.5}
        moving
        label="Teaser, processing progress"
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Teaser, processing progress' });
    // two done steps and half of the third, out of four
    expect(bar).toHaveAttribute('aria-valuenow', '63');
    expect(widths()).toEqual(['100%', '100%', '50%', '0%']);
    expect(document.querySelectorAll('[data-moving]')).toHaveLength(1);
    const items = within(screen.getByRole('list', { name: 'Processing steps' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual([
      'Upload, done',
      'Transcode, done',
      'Store on Sia, in progress',
      'Publish, not started',
    ]);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
  });

  it('runs a light instead of a fill while the step has no number yet', () => {
    render(<PipelineProgress steps={['done', 'active', 'pending', 'pending']} label="x" />);
    // the active step has no fill element, only the light
    expect(widths()).toEqual(['100%', '0%', '0%']);
  });

  it('keeps still and says so when a step failed', () => {
    render(
      <PipelineProgress
        steps={['done', 'failed', 'pending', 'pending']}
        percent={30}
        moving
        label="x"
      />,
    );
    expect(document.querySelectorAll('[data-moving]')).toHaveLength(0);
    expect(screen.getByText('Transcode')).toHaveTextContent('Transcode, failed');
  });

  it('previews the steps without a progressbar or states before anything runs', () => {
    render(
      <PipelineProgress
        preview
        steps={['pending', 'pending', 'pending', 'pending']}
        label="What happens next"
      />,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'What happens next' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual([
      'Upload',
      'Transcode',
      'Store on Sia',
      'Publish',
    ]);
  });
});
