import { describe, expect, it } from 'vitest';
import {
  failureInfo,
  isWaitingForSia,
  jobSummary,
  processingView,
  SIA_WAIT_MESSAGE,
  stageLabel,
  type Job,
} from './processing';

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

describe('processingView', () => {
  it('names each live stage with the glossary labels', () => {
    expect(jobSummary(job())).toBe('Transcoding, 30%');
    expect(jobSummary(job({ stage: 'upload', progressPercent: 72.4 }))).toBe('Storing on Sia, 72%');
    expect(jobSummary(job({ stage: 'finalize', progressPercent: 95 }))).toBe('Publishing, 95%');
    expect(jobSummary(job({ status: 'queued', stage: 'queued', logs: [] }))).toBe(
      'Waiting to start',
    );
    expect(jobSummary(job({ status: 'completed', stage: 'completed' }))).toBe('Done');
    expect(jobSummary(job({ status: 'retrying', stage: 'upload' }))).toBe(
      'Storing on Sia, trying again',
    );
  });

  it('gives tone, percent and pipeline step', () => {
    expect(processingView(job({ stage: 'upload', progressPercent: 70 }))).toEqual({
      label: 'Storing on Sia',
      detail: null,
      tone: 'progress',
      percent: 70,
      step: 'store',
      busy: true,
    });
    expect(processingView(job({ status: 'queued', stage: 'queued', logs: [] }))).toMatchObject({
      tone: 'neutral',
      percent: null,
      step: null,
      busy: false,
    });
    expect(processingView(job({ status: 'completed', stage: 'completed' }))).toMatchObject({
      tone: 'success',
      percent: 100,
      step: 'publish',
    });
  });

  it('places a failed job at the step its last log line names', () => {
    const failed = job({ status: 'failed', stage: 'failed', logs: [log('upload')] });
    expect(processingView(failed)).toMatchObject({
      label: 'Failed',
      tone: 'danger',
      step: 'store',
      percent: null,
      busy: false,
    });
  });

  it('reads the Sia wait from the hand-off log line (B-14) as storing, not transcoding', () => {
    const waiting = job({
      stage: 'upload',
      progressPercent: 65,
      logs: [log('transcode', 'Transcode complete'), log('upload', SIA_WAIT_MESSAGE)],
    });
    expect(isWaitingForSia(waiting)).toBe(true);
    expect(processingView(waiting)).toMatchObject({
      label: 'Storing on Sia',
      detail: 'Waiting for the Sia uploader',
      step: 'store',
      percent: 65,
    });
    // once the uploader starts it logs its own line
    const uploading = job({ stage: 'upload', logs: [log('upload', 'Uploading segments to Sia')] });
    expect(isWaitingForSia(uploading)).toBe(false);
  });

  it('keeps the percent between 0 and 100', () => {
    expect(processingView(job({ progressPercent: 140 })).percent).toBe(100);
    expect(processingView(job({ progressPercent: -3 })).percent).toBe(0);
  });

  it('labels log stages, keeping unknown ones as they are', () => {
    expect(stageLabel('finalize')).toBe('Publishing');
    expect(stageLabel('something')).toBe('something');
  });
});

describe('failureInfo', () => {
  const failed = (over: Partial<Job>) =>
    job({ status: 'failed', stage: 'failed', progressPercent: 0, ...over });
  const asset = { status: 'failed' as const };

  it('uses the server retryable flag when it is there (B-15)', () => {
    const info = failureInfo(
      failed({ errorMessage: 'connection reset', logs: [log('upload')], retryable: false }),
      asset,
    );
    expect(info).toMatchObject({ retryable: false, action: 'reupload' });
    expect(
      failureInfo(failed({ errorMessage: 'ffprobe exited with code 1', retryable: true }), asset),
    ).toMatchObject({ retryable: true, action: 'retry' });
  });

  it('names an unreadable file plainly when the server says it is final, raw text in detail', () => {
    const message =
      'ffprobe exited with code 1: /app/uploads/bf58: Invalid data found when processing input';
    expect(failureInfo(failed({ errorMessage: message, retryable: false }), asset)).toEqual({
      title: 'Processing failed',
      body: 'The file is not a readable video.',
      retryable: false,
      action: 'reupload',
      detail: message,
    });
  });

  it('says which step failed and whether retrying helps', () => {
    expect(failureInfo(failed({ errorMessage: 'x', logs: [log('upload')] }), asset).body).toBe(
      'Storing the video on Sia failed. Retrying usually works.',
    );
    expect(failureInfo(failed({ errorMessage: 'x', logs: [log('finalize')] }), asset).body).toBe(
      'Publishing the video failed. Retrying usually works.',
    );
    expect(failureInfo(failed({ errorMessage: 'x', logs: [log('transcode')] }), asset).body).toBe(
      'Transcoding the video failed.',
    );
    expect(
      failureInfo(failed({ errorMessage: 'x', logs: [log('upload')], retryable: false }), asset)
        .body,
    ).toBe('Storing the video on Sia failed.');
  });

  it('says the source is gone when the server lost it', () => {
    const info = failureInfo(
      failed({ errorMessage: 'ENOENT: no such file or directory', retryable: false }),
      asset,
    );
    expect(info.body).toBe('The original file is no longer on the server.');
    expect(info.action).toBe('reupload');
  });

  it('copes with no job and no message', () => {
    expect(failureInfo(undefined, asset)).toEqual({
      title: 'Processing failed',
      body: 'Processing failed before it recorded a reason.',
      retryable: true,
      action: 'retry',
      detail: null,
    });
  });

  it('offers nothing for a video that is not failed', () => {
    expect(failureInfo(failed({}), { status: 'processing' }).action).toBe('none');
  });
});
