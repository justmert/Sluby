import { describe, it, expect, vi } from 'vitest';
import { createKeyUseRecorder } from '../api/auth/key-usage.js';

describe('key use recorder', () => {
  function harness(start = 1_000_000) {
    let t = start;
    const write = vi.fn(async (_id: string) => {});
    const onError = vi.fn();
    const record = createKeyUseRecorder({ write, onError, now: () => t });
    return {
      record,
      write,
      onError,
      advance: (ms: number) => {
        t += ms;
      },
      at: () => t,
    };
  }

  it('writes a key once for two uses within a minute', () => {
    const h = harness();
    h.record('k1', null);
    h.advance(30_000);
    h.record('k1', null);
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledWith('k1');
  });

  it('writes again once a minute has passed', () => {
    const h = harness();
    h.record('k1', null);
    h.advance(60_000);
    h.record('k1', null);
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it('skips a key whose stored use is under a minute old', () => {
    const h = harness();
    h.record('k1', new Date(h.at() - 59_000));
    expect(h.write).not.toHaveBeenCalled();
    h.record('k1', new Date(h.at() - 61_000));
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('throttles each key on its own', () => {
    const h = harness();
    h.record('k1', null);
    h.record('k2', null);
    h.record('k1', null);
    expect(h.write.mock.calls.map((c) => c[0])).toEqual(['k1', 'k2']);
  });

  it('reports a failed write and lets the next use try again', async () => {
    const h = harness();
    const boom = new Error('db down');
    h.write.mockRejectedValueOnce(boom);
    h.record('k1', null);
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledWith(boom, 'k1'));
    h.record('k1', null);
    expect(h.write).toHaveBeenCalledTimes(2);
  });
});
