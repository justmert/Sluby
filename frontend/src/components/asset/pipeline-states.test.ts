import { describe, expect, it } from 'vitest';
import { assetSteps, uploadSteps } from './pipeline-states';
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
    logs: [log('transcode')],
    retryable: true,
    ...over,
  };
}

describe('assetSteps', () => {
  it('draws the upload as the running step while the file is still arriving (FLW-12)', () => {
    expect(assetSteps({ status: 'created' })).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(assetSteps({ status: 'uploading' })).toEqual([
      'active',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('marks an interrupted upload as stopped, not running', () => {
    expect(assetSteps({ status: 'uploading' }, undefined, { interrupted: true })).toEqual([
      'stopped',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('draws no later step as running while the processing status is unknown (FLW-11)', () => {
    expect(assetSteps({ status: 'processing' })).toEqual(['done', 'pending', 'pending', 'pending']);
    expect(assetSteps({ status: 'failed' }, null)).toEqual([
      'done',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('follows the job through transcode, the Sia wait, storing and publishing', () => {
    expect(assetSteps({ status: 'processing' }, job())).toEqual([
      'done',
      'active',
      'pending',
      'pending',
    ]);
    const wait = job({ logs: [log('transcode'), log('upload', SIA_WAIT_MESSAGE)] });
    expect(assetSteps({ status: 'processing' }, wait)).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    expect(assetSteps({ status: 'processing' }, job({ stage: 'upload' }))).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    expect(assetSteps({ status: 'processing' }, job({ stage: 'finalize' }))).toEqual([
      'done',
      'done',
      'done',
      'active',
    ]);
  });

  it('shows a queued job as waiting on the transcode, with nothing spinning', () => {
    expect(
      assetSteps({ status: 'processing' }, job({ status: 'queued', stage: 'queued', logs: [] })),
    ).toEqual(['done', 'waiting', 'pending', 'pending']);
  });

  it('puts a failure on the step the last log line names', () => {
    const failed = job({ status: 'failed', stage: 'failed', logs: [log('upload')] });
    expect(assetSteps({ status: 'failed' }, failed)).toEqual(['done', 'done', 'failed', 'pending']);
  });

  it('trusts the job over a stale asset status once a retry has started', () => {
    expect(assetSteps({ status: 'failed' }, job())).toEqual([
      'done',
      'active',
      'pending',
      'pending',
    ]);
  });

  it('is all done for a ready video or a completed job', () => {
    expect(assetSteps({ status: 'ready' })).toEqual(['done', 'done', 'done', 'done']);
    expect(
      assetSteps({ status: 'processing' }, job({ status: 'completed', stage: 'completed' })),
    ).toEqual(['done', 'done', 'done', 'done']);
  });
});

describe('uploadSteps', () => {
  const base = { job: null, failedDuring: null } as const;

  it('covers every phase of an upload in this browser', () => {
    expect(uploadSteps({ ...base, phase: 'uploading' })).toEqual([
      'active',
      'pending',
      'pending',
      'pending',
    ]);
    expect(uploadSteps({ ...base, phase: 'paused' })).toEqual([
      'paused',
      'pending',
      'pending',
      'pending',
    ]);
    expect(uploadSteps({ ...base, phase: 'processing', job: job({ stage: 'upload' }) })).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    expect(uploadSteps({ ...base, phase: 'ready' })).toEqual(['done', 'done', 'done', 'done']);
    expect(uploadSteps({ ...base, phase: 'cancelled' })).toEqual([
      'cancelled',
      'skipped',
      'skipped',
      'skipped',
    ]);
  });

  it('puts a failure on the transfer or on the processing step', () => {
    expect(uploadSteps({ ...base, phase: 'failed', failedDuring: 'upload' })).toEqual([
      'failed',
      'pending',
      'pending',
      'pending',
    ]);
    const failed = job({ status: 'failed', stage: 'failed', logs: [log('transcode')] });
    expect(uploadSteps({ phase: 'failed', failedDuring: 'processing', job: failed })).toEqual([
      'done',
      'failed',
      'pending',
      'pending',
    ]);
  });
});
