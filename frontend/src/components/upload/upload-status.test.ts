import { describe, expect, it } from 'vitest';
import { job, upload } from '@/test/upload-state';
import { badgeStatus, endedText, sentOf, shortStatus, statusLine, timeLeft } from './upload-status';

describe('upload status line', () => {
  it('says percent, bytes and time left while sending, and no time before the speed settles', () => {
    expect(statusLine(upload({ bytesUploaded: 5_400_000 })).text).toBe('45% · 5.4 of 12 MB');
    expect(
      statusLine(upload({ bytesUploaded: 5_400_000, speed: 220_000, activeMs: 5_000 })).text,
    ).toBe('45% · 5.4 of 12 MB · about 30 seconds left');
  });

  it('spells both units out when they differ', () => {
    expect(sentOf(410_000, 2_400_000)).toBe('410 KB of 2.4 MB');
  });

  it('rounds time left so it does not flicker', () => {
    expect(timeLeft(4_000)).toBe('a few seconds left');
    expect(timeLeft(42_000)).toBe('about 40 seconds left');
    expect(timeLeft(150_000)).toBe('about 3 minutes left');
  });

  it('reads a paused upload once, without repeating the badge', () => {
    expect(statusLine(upload({ phase: 'paused', bytesUploaded: 6_000_000 })).text).toBe(
      '50% · 6 of 12 MB sent',
    );
  });

  it('names the processing stage, the Sia wait and the attempt', () => {
    const p = (j: Parameters<typeof job>[0], more = {}) =>
      statusLine(upload({ phase: 'processing', job: job(j), ...more }));
    expect(p({ stage: 'transcode', progressPercent: 40 }).text).toBe('Transcoding, 40%');
    const wait = p({
      stage: 'upload',
      progressPercent: 65,
      logs: [{ stage: 'upload', message: 'Waiting for the Sia uploader', timestamp: '' }],
    });
    expect(wait).toMatchObject({
      text: 'Storing on Sia, 65%',
      detail: 'Waiting for the Sia uploader',
    });
    expect(
      p({ status: 'retrying', stage: 'upload', retryCount: 5 }, { attempt: { n: 2, of: 3 } }).text,
    ).toBe('Storing on Sia, trying again (attempt 2 of 3)');
    expect(statusLine(upload({ phase: 'processing' }))).toMatchObject({
      text: 'Waiting to start',
      bar: 'waiting',
    });
  });

  it('keeps the stage through a polling hiccup and says it checks again', () => {
    const s = statusLine(
      upload({ phase: 'processing', checking: true, job: job({ progressPercent: 30 }) }),
    );
    expect(s).toMatchObject({
      text: 'Transcoding, 30%',
      detail: 'Checking again in a few seconds.',
      tone: 'muted',
    });
  });

  it('words cancels in US English and says what was kept', () => {
    expect(statusLine(upload({ phase: 'cancelled', cleanup: 'pending' })).text).toBe('Canceling…');
    expect(statusLine(upload({ phase: 'cancelled', cleanup: 'done' })).text).toBe(
      'Upload canceled. Nothing was kept.',
    );
    expect(statusLine(upload({ phase: 'cancelled', cleanup: 'nothing' })).text).toBe(
      'Upload canceled before it reached the server.',
    );
    expect(shortStatus(upload({ phase: 'cancelled' }))).toBe('Canceled');
  });

  it('shows a failure in red with its reason', () => {
    expect(
      statusLine(upload({ phase: 'failed', error: 'The file is not a readable video.' })),
    ).toMatchObject({ text: 'The file is not a readable video.', tone: 'danger' });
  });
});

describe('an upload whose video was deleted elsewhere', () => {
  const gone = upload({
    phase: 'failed',
    failedDuring: 'processing',
    assetGone: true,
    error: 'This video was deleted before processing finished.',
  });

  it('reads as deleted, not as a red failure', () => {
    expect(badgeStatus(gone)).toBe('deleted');
    expect(statusLine(gone).tone).toBe('muted');
    expect(shortStatus(gone)).toBe('Deleted');
    expect(endedText(gone)).toBe('“Clip” was deleted before processing finished.');
  });

  it('keeps a real failure red and says it failed', () => {
    const failed = upload({ phase: 'failed', error: 'The file is not a readable video.' });
    expect(badgeStatus(failed)).toBe('failed');
    expect(statusLine(failed).tone).toBe('danger');
    expect(endedText(failed)).toBe('“Clip” failed. The file is not a readable video.');
    expect(badgeStatus(upload({ phase: 'failed', lostConnection: true }))).toBe('offline');
  });
});
