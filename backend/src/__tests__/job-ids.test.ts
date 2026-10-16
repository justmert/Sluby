import { describe, it, expect } from 'vitest';
import { stageJobId } from '../queue/job-ids.js';

describe('stageJobId', () => {
  it('keeps the plain ids for the first attempt', () => {
    expect(stageJobId('upload', 'a1')).toBe('upload-a1');
    expect(stageJobId('finalize', 'a1')).toBe('finalize-a1');
  });

  it('gives a retry its own ids so the failed attempt cannot shadow them', () => {
    expect(stageJobId('upload', 'a1', 'retry-1')).toBe('upload-a1-retry-1');
    expect(stageJobId('finalize', 'a1', 'retry-1')).toBe('finalize-a1-retry-1');
    expect(stageJobId('finalize', 'a1', 'retry-2')).not.toBe(
      stageJobId('finalize', 'a1', 'retry-1'),
    );
  });
});
