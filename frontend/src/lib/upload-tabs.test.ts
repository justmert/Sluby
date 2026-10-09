import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBus, fakeLocks } from '@/test/fake-tabs';
import { createUploadTabs, fileFingerprint, HEARTBEAT_MS, type SharedUpload } from './upload-tabs';

const sending = (over: Partial<SharedUpload> = {}): SharedUpload => ({
  fingerprint: 'clip.mp4-video/mp4-100-1',
  uploadId: 'u1',
  assetId: null,
  title: 'Clip',
  fileName: 'clip.mp4',
  bytesUploaded: 7,
  bytesTotal: 100,
  paused: false,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function twoTabs(locks: LockManager | null = fakeLocks()) {
  const bus = fakeBus();
  const a = createUploadTabs({ channel: bus.channel(), locks, pageTarget: null });
  const b = createUploadTabs({ channel: bus.channel(), locks, pageTarget: null });
  return { a, b, bus };
}

describe('upload tabs', () => {
  it('fingerprints a file the way both tabs compute it', () => {
    const f = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4', lastModified: 1 });
    expect(fileFingerprint(f)).toBe('clip.mp4-video/mp4-100-1');
  });

  it('lets one tab claim a file and refuses the second until it is released', async () => {
    const { a, b } = twoTabs();
    const release = await a.claim('f');
    expect(release).toBeTypeOf('function');
    expect(await b.claim('f')).toBeNull();
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(await b.claim('f')).toBeTypeOf('function');
  });

  it('shows what another tab is sending and forgets it when that tab stops', () => {
    const { a, b } = twoTabs();
    a.publish([sending()]);
    expect(b.remote()).toEqual([expect.objectContaining({ uploadId: 'u1', bytesUploaded: 7 })]);
    expect(b.ownedElsewhere('clip.mp4-video/mp4-100-1')).toBe(true);
    expect(a.remote()).toEqual([]);

    a.publish([]);
    expect(b.remote()).toEqual([]);
  });

  it('tells the other tabs at once which video an upload goes to', () => {
    const { a, b } = twoTabs();
    a.publish([sending()]);
    a.publish([sending({ assetId: 'v1' })]);
    expect(b.remote()).toEqual([expect.objectContaining({ assetId: 'v1' })]);
  });

  it('keeps announcing every heartbeat and drops a tab that went quiet', () => {
    const { a, b } = twoTabs();
    a.publish([sending()]);
    vi.advanceTimersByTime(HEARTBEAT_MS * 5);
    expect(b.remote()).toHaveLength(1);
  });

  it('drops a tab that crashed without a goodbye once its heartbeats stop', () => {
    const bus = fakeBus();
    const b = createUploadTabs({ channel: bus.channel(), locks: null, pageTarget: null });
    // one report, then silence, as from a tab the browser killed
    bus.channel().postMessage({ type: 'state', tabId: 'gone', uploads: [sending()] });
    expect(b.remote()).toHaveLength(1);
    vi.advanceTimersByTime(HEARTBEAT_MS * 4);
    expect(b.remote()).toEqual([]);
  });

  it('keeps listing an upload whose tab went quiet while that tab still holds the file', async () => {
    const locks = fakeLocks();
    const bus = fakeBus();
    const b = createUploadTabs({ channel: bus.channel(), locks, pageTarget: null });
    // a tab in the background: the browser throttles its timers, so its
    // heartbeats stop, but it keeps the file's lock while it sends
    let release!: () => void;
    void locks.request(
      'sluby-upload:clip.mp4-video/mp4-100-1',
      { ifAvailable: true },
      () => new Promise<void>((r) => (release = r)),
    );
    bus.channel().postMessage({ type: 'state', tabId: 'hidden', uploads: [sending()] });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 10);
    expect(b.remote()).toEqual([expect.objectContaining({ uploadId: 'u1' })]);
    expect(b.ownedElsewhere('clip.mp4-video/mp4-100-1')).toBe(true);

    // the tab closed or finished: the lock is gone and so is the row
    release();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    expect(b.remote()).toEqual([]);
  });

  it('answers a tab that just opened without waiting for the next heartbeat', () => {
    const bus = fakeBus();
    const a = createUploadTabs({ channel: bus.channel(), locks: null, pageTarget: null });
    a.publish([sending()]);
    const late = createUploadTabs({ channel: bus.channel(), locks: null, pageTarget: null });
    expect(late.remote()).toHaveLength(1);
  });

  it('a closed tab says goodbye', () => {
    const { a, b } = twoTabs();
    a.publish([sending()]);
    a.close();
    expect(b.remote()).toEqual([]);
  });

  it('without web locks, refuses a file another tab announces', async () => {
    const { a, b } = twoTabs(null);
    a.publish([sending()]);
    expect(await b.claim('clip.mp4-video/mp4-100-1')).toBeNull();
    expect(await b.claim('other')).toBeTypeOf('function');
  });

  it('without a channel, nothing is shared and claims rely on the lock alone', async () => {
    const locks = fakeLocks();
    const a = createUploadTabs({ channel: null, locks, pageTarget: null });
    const b = createUploadTabs({ channel: null, locks, pageTarget: null });
    a.publish([sending()]);
    expect(b.remote()).toEqual([]);
    expect(await a.claim('f')).toBeTypeOf('function');
    expect(await b.claim('f')).toBeNull();
  });
});
