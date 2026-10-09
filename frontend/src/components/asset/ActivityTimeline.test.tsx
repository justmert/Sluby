import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SlubyError } from '@sluby/sdk';
import { renderPage } from '@/test/render';
import { ActivityTimeline } from './ActivityTimeline';
import type { Job } from './processing';

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1',
  status: 'completed',
  stage: 'completed',
  progressPercent: 100,
  retryCount: 0,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-09T00:00:00Z',
  logs: [
    { timestamp: '2026-10-09T10:00:00Z', stage: 'transcode', message: 'Starting transcode' },
    { timestamp: '2026-10-09T10:01:00Z', stage: 'upload', message: 'Uploading 12 segments' },
    { timestamp: '2026-10-09T10:02:00Z', stage: 'finalize', message: 'Done' },
  ],
  ...over,
});

const base = { isLoading: false, error: null, onRetry: vi.fn(), retrying: false };

describe('ActivityTimeline', () => {
  it('lists the log with the stage labels, not the raw keys (CPY-36)', () => {
    renderPage(<ActivityTimeline {...base} job={job()} />);
    const log = screen.getByRole('region', { name: 'Processing log' });
    expect(log).toHaveAttribute('tabindex', '0');
    const rows = within(log).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Transcoding')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Storing on Sia')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Publishing')).toBeInTheDocument();
    expect(within(log).queryByText('finalize')).toBeNull();
  });

  it('marks the line a run failed on, and only that one', () => {
    renderPage(<ActivityTimeline {...base} job={job({ status: 'failed', stage: 'failed' })} />);
    const rows = within(screen.getByRole('region', { name: 'Processing log' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((r) => r.hasAttribute('data-failed'))).toEqual([false, false, true]);
  });

  it('wraps long messages on narrow screens instead of a 70px column (A11Y-29)', () => {
    renderPage(<ActivityTimeline {...base} job={job()} />);
    const message = screen.getByText('Starting transcode');
    expect(message.className).toContain('wrap-anywhere');
    expect(message.className).toContain('col-span-2');
  });

  it('says how many times the run was tried again', () => {
    renderPage(<ActivityTimeline {...base} job={job({ retryCount: 2 })} />);
    expect(screen.getByText(/Tried again 2 times/)).toBeInTheDocument();
  });

  it('says nothing has run yet when there is no job', () => {
    renderPage(
      <ActivityTimeline {...base} job={undefined} error={new SlubyError('No job', 404)} />,
    );
    expect(screen.getByText('Nothing has run yet')).toBeInTheDocument();
  });

  it('offers Try again when the log does not load', async () => {
    const onRetry = vi.fn();
    renderPage(
      <ActivityTimeline
        {...base}
        onRetry={onRetry}
        job={undefined}
        error={new SlubyError('boom', 500)}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Could not load the processing log')).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says so when a job recorded nothing', () => {
    renderPage(<ActivityTimeline {...base} job={job({ logs: [] })} />);
    expect(screen.getByText('No details were recorded.')).toBeInTheDocument();
  });
});
