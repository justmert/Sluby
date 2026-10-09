import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { ProcessingCard, type ProcessingCardProps } from './ProcessingCard';
import { SIA_WAIT_MESSAGE, type Job } from './processing';

const log = (stage: string, message = 'line') => ({
  timestamp: '2026-10-09T00:00:00Z',
  stage,
  message,
});

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    status: 'processing',
    stage: 'transcode',
    progressPercent: 30,
    retryCount: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-09T00:00:00Z',
    retryable: false,
    logs: [log('transcode')],
    ...over,
  };
}

const asset = { id: 'a1', title: 'Teaser', status: 'processing' as const };

function show(over: Partial<ProcessingCardProps> = {}) {
  const props: ProcessingCardProps = {
    asset,
    job: job(),
    jobError: false,
    checking: false,
    onCheckAgain: vi.fn(),
    interrupted: false,
    onDelete: vi.fn(),
    ...over,
  };
  renderPage(<ProcessingCard {...props} />);
  return props;
}

const steps = () =>
  within(screen.getByRole('list', { name: 'Processing steps' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('ProcessingCard', () => {
  it('shows the running step, its percent and a progress bar', () => {
    show({ job: job({ stage: 'upload', progressPercent: 72.4 }) });
    const card = screen.getByRole('region', { name: 'Processing' });
    expect(within(card).getByText('Storing on Sia')).toBeInTheDocument();
    expect(within(card).getByText('72%')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Teaser, processing progress' }),
    ).toBeInTheDocument();
    expect(steps()).toEqual([
      'Upload, done',
      'Transcode, done',
      'Store on Sia, in progress',
      'Publish, not started',
    ]);
  });

  it('says Storing on Sia during the wait for the Sia uploader (FLW-08)', () => {
    show({
      job: job({ progressPercent: 65, logs: [log('transcode'), log('upload', SIA_WAIT_MESSAGE)] }),
    });
    expect(screen.getByText('Storing on Sia')).toBeInTheDocument();
    expect(screen.getByText(SIA_WAIT_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/Transcoding/)).toBeNull();
  });

  it('says it cannot read the status instead of guessing a step, and checks again (FLW-11)', async () => {
    const props = show({ job: undefined, jobError: true });
    expect(screen.getByText('Could not read the processing status.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting to start')).toBeNull();
    expect(steps().filter((s) => s?.endsWith('in progress'))).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(props.onCheckAgain).toHaveBeenCalled();
  });

  it('keeps the last status it read when a later read fails', () => {
    show({ job: job({ stage: 'upload', progressPercent: 80 }), jobError: true });
    expect(screen.getByText('Storing on Sia')).toBeInTheDocument();
    expect(
      screen.getByText('Could not read the processing status. Showing the last one that loaded.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('draws the upload as running while the file is still arriving (FLW-12)', () => {
    show({ asset: { ...asset, status: 'uploading' }, job: undefined });
    expect(screen.getByRole('heading', { name: 'Uploading' })).toBeInTheDocument();
    expect(steps()[0]).toBe('Upload, in progress');
  });

  it('turns a stopped upload into Upload interrupted with Delete (FLW-12)', async () => {
    const props = show({
      asset: { ...asset, status: 'created' },
      job: undefined,
      interrupted: true,
    });
    expect(screen.getByRole('heading', { name: 'Upload interrupted' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Add the same file again in that browser to continue, or delete this video\. Unfinished uploads are removed after 24 hours\./,
      ),
    ).toBeInTheDocument();
    expect(steps()[0]).toBe('Upload, stopped');
    await userEvent.click(screen.getByRole('button', { name: 'Delete video' }));
    expect(props.onDelete).toHaveBeenCalled();
  });

  it('offers Retry for a failure that retrying can fix, after Delete', () => {
    show({
      asset: { ...asset, status: 'failed' },
      job: job({
        status: 'failed',
        stage: 'failed',
        errorMessage: 'connection reset',
        logs: [log('upload')],
        retryable: true,
      }),
    });
    expect(screen.getByRole('heading', { name: 'Processing failed' })).toBeInTheDocument();
    expect(
      screen.getByText('Storing the video on Sia failed. Retrying usually works.'),
    ).toBeInTheDocument();
    const buttons = within(screen.getByRole('region', { name: 'Processing failed' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    // secondary first, primary last (VIS-26)
    expect(buttons.slice(-2)).toEqual(['Delete video', 'Retry processing']);
    expect(steps()[2]).toBe('Store on Sia, failed');
  });

  it('offers a new upload instead of Retry for a file that is not a video (FLW-22)', async () => {
    show({
      asset: { ...asset, status: 'failed' },
      job: job({
        status: 'failed',
        stage: 'failed',
        errorMessage:
          'ffprobe exited with code 1: /app/uploads/x: Invalid data found when processing input',
        retryable: false,
      }),
    });
    expect(screen.getByText('The file is not a readable video.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry processing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload a different file' })).toBeInTheDocument();
    // the ffmpeg line with the server path only under Details
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText(/\/app\/uploads\/x/).closest('details')).not.toBeNull();
  });

  it('says no details were recorded when a failure has no message (CPY-35)', () => {
    show({
      asset: { ...asset, status: 'failed' },
      job: job({ status: 'failed', stage: 'failed', logs: [] }),
    });
    expect(screen.getByText('No details were recorded.')).toBeInTheDocument();
    expect(screen.queryByText('The pipeline stopped')).toBeNull();
  });
});
