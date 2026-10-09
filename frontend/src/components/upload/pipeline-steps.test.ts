import { describe, expect, it } from 'vitest';
import type { ProcessingJob } from '@sluby/sdk';
import { job, upload } from '@/test/upload-state';
import { stepStates } from './pipeline-steps';

const base = upload({ phase: 'processing', assetId: 'a', uploadId: 'u' });
const withJob = (stage: string, logs: Array<{ stage: string }> = []) =>
  job({
    stage: stage as ProcessingJob['stage'],
    logs: logs.map((l) => ({ ...l, timestamp: '', message: '' })),
  });

describe('stepStates', () => {
  it('follows the backend stage through the pipeline', () => {
    expect(stepStates({ ...base, job: withJob('upload') })).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    expect(stepStates({ ...base, phase: 'ready', job: withJob('completed') })).toEqual([
      'done',
      'done',
      'done',
      'done',
    ]);
  });

  it('shows a paused transfer as paused, not active', () => {
    expect(stepStates({ ...base, phase: 'paused' })).toEqual([
      'paused',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('shows a cancelled upload as cancelled, with nothing after it waiting', () => {
    expect(stepStates({ ...base, phase: 'cancelled', job: null })).toEqual([
      'cancelled',
      'skipped',
      'skipped',
      'skipped',
    ]);
  });

  it('marks the step a failed job died in', () => {
    expect(
      stepStates({
        ...base,
        phase: 'failed',
        failedDuring: 'processing',
        job: withJob('failed', [{ stage: 'transcode' }, { stage: 'upload' }]),
      }),
    ).toEqual(['done', 'done', 'failed', 'pending']);
  });
});
