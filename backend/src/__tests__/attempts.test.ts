import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { AttemptLimiter } from '../api/auth/attempts.js';

describe('AttemptLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows a key until it reaches the limit', () => {
    const limiter = new AttemptLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.check('a')).toEqual({ ok: true });
    limiter.fail('a');
    limiter.fail('a');
    expect(limiter.check('a')).toEqual({ ok: true });
    limiter.fail('a');
    expect(limiter.check('a')).toEqual({ ok: false, retryAfterSec: 60 });
  });

  it('keeps keys apart', () => {
    const limiter = new AttemptLimiter({ limit: 1, windowMs: 60_000 });
    limiter.fail('a');
    expect(limiter.check('a').ok).toBe(false);
    expect(limiter.check('b')).toEqual({ ok: true });
  });

  it('counts retryAfterSec down to the end of the window, rounding up', () => {
    const limiter = new AttemptLimiter({ limit: 1, windowMs: 60_000 });
    limiter.fail('a');
    vi.advanceTimersByTime(20_500);
    expect(limiter.check('a')).toEqual({ ok: false, retryAfterSec: 40 });
    vi.advanceTimersByTime(39_000);
    expect(limiter.check('a')).toEqual({ ok: false, retryAfterSec: 1 });
  });

  it('opens again once the window has passed', () => {
    const limiter = new AttemptLimiter({ limit: 2, windowMs: 60_000 });
    limiter.fail('a');
    limiter.fail('a');
    expect(limiter.check('a').ok).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(limiter.check('a')).toEqual({ ok: true });
    // the next window starts from zero
    limiter.fail('a');
    expect(limiter.check('a')).toEqual({ ok: true });
  });

  it('keeps a fixed window from the first failure', () => {
    const limiter = new AttemptLimiter({ limit: 2, windowMs: 60_000 });
    limiter.fail('a');
    vi.advanceTimersByTime(50_000);
    limiter.fail('a');
    expect(limiter.check('a')).toEqual({ ok: false, retryAfterSec: 10 });
    vi.advanceTimersByTime(10_000);
    expect(limiter.check('a')).toEqual({ ok: true });
  });

  it('reset clears one key', () => {
    const limiter = new AttemptLimiter({ limit: 1, windowMs: 60_000 });
    limiter.fail('a');
    limiter.fail('b');
    limiter.reset('a');
    expect(limiter.check('a')).toEqual({ ok: true });
    expect(limiter.check('b').ok).toBe(false);
  });

  it('sweeps expired windows', () => {
    const limiter = new AttemptLimiter({ limit: 1, windowMs: 1_000 });
    limiter.fail('a');
    limiter.fail('b');
    expect(limiter.size).toBe(2);
    vi.advanceTimersByTime(60_000);
    expect(limiter.size).toBe(0);
  });
});
