import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';
import {
  createPlayCounter,
  DEDUPE_WINDOW_MS,
  fromStudio,
  viewerOf,
  type PlayRow,
} from '../delivery/plays.js';

function harness(start = Date.parse('2026-10-09T23:59:50Z')) {
  let t = start;
  const written: PlayRow[][] = [];
  const write = vi.fn(async (rows: PlayRow[]) => {
    written.push(rows);
  });
  const onError = vi.fn();
  const counter = createPlayCounter({ write, onError, now: () => t });
  return { counter, written, write, onError, advance: (ms: number) => (t += ms) };
}

describe('play counter', () => {
  it('counts one play per viewer and video within the window', async () => {
    const h = harness();
    expect(h.counter.record('a1', 'viewer-1')).toBe(true);
    expect(h.counter.record('a1', 'viewer-1')).toBe(false);
    expect(h.counter.record('a1', 'viewer-2')).toBe(true);
    expect(h.counter.record('a2', 'viewer-1')).toBe(true);
    await h.counter.flush();
    expect(h.written).toHaveLength(1);
    expect(h.written[0].map((r) => [r.assetId, r.day, r.plays]).sort()).toEqual([
      ['a1', '2026-10-09', 2],
      ['a2', '2026-10-09', 1],
    ]);
  });

  it('counts the same viewer again once the window has passed', async () => {
    const h = harness();
    h.counter.record('a1', 'v');
    h.advance(DEDUPE_WINDOW_MS);
    expect(h.counter.record('a1', 'v')).toBe(true);
    await h.counter.flush();
    // the second play fell on the next utc day
    expect(h.written[0].map((r) => [r.day, r.plays])).toEqual([
      ['2026-10-09', 1],
      ['2026-10-10', 1],
    ]);
  });

  it('keeps the newest play time per row, writes nothing when idle, and each play once', async () => {
    const h = harness(Date.parse('2026-10-09T10:00:00Z'));
    h.counter.record('a1', 'v1');
    h.advance(5_000);
    h.counter.record('a1', 'v2');
    await h.counter.flush();
    expect(h.written[0][0].lastPlayedAt.toISOString()).toBe('2026-10-09T10:00:05.000Z');
    await h.counter.flush();
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('reports a failed write with what was lost', async () => {
    const h = harness();
    const boom = new Error('db down');
    h.write.mockRejectedValueOnce(boom);
    h.counter.record('a1', 'v');
    await h.counter.flush();
    expect(h.onError).toHaveBeenCalledWith(boom, [expect.objectContaining({ plays: 1 })]);
  });

  it('flushes on a timer and once more on stop', async () => {
    vi.useFakeTimers();
    try {
      const written: PlayRow[][] = [];
      const counter = createPlayCounter({
        write: async (rows) => {
          written.push(rows);
        },
        onError: () => {},
      });
      counter.start(10_000);
      counter.record('a1', 'v');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(written).toHaveLength(1);
      counter.record('a2', 'v');
      await counter.stop();
      expect(written).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('viewers and studio previews', () => {
  const req = (headers: Record<string, string>, ip = '203.0.113.5') =>
    ({ ip, get: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

  it('tells viewers apart by address and user agent, without keeping the address', () => {
    const a = viewerOf(req({ 'user-agent': 'Firefox' }));
    expect(viewerOf(req({ 'user-agent': 'Firefox' }))).toBe(a);
    expect(viewerOf(req({ 'user-agent': 'Safari' }))).not.toBe(a);
    expect(viewerOf(req({ 'user-agent': 'Firefox' }, '203.0.113.6'))).not.toBe(a);
    expect(a).not.toContain('203.0.113.5');
  });

  it('knows a request from a studio page of this server', () => {
    const host = { host: 'sluby.example' };
    expect(fromStudio(req({ ...host, referer: 'https://sluby.example/studio/videos/1' }))).toBe(
      true,
    );
    expect(fromStudio(req({ ...host, referer: 'https://sluby.example/studio' }))).toBe(true);
    expect(fromStudio(req({ ...host, referer: 'https://sluby.example/studios' }))).toBe(false);
    expect(fromStudio(req({ ...host, referer: 'https://blog.example/studio/post' }))).toBe(false);
    expect(fromStudio(req({ ...host, referer: 'https://blog.example/' }))).toBe(false);
    expect(fromStudio(req(host))).toBe(false);
  });
});
