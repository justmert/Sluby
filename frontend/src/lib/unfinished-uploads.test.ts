import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, reply } from '@/test/render';
import { findUnfinishedUploads, isSameFile, recheckUnfinishedUpload } from './unfinished-uploads';

const entry = (url: string, title = 'Clip') =>
  JSON.stringify({
    size: 1000,
    uploadUrl: url,
    creationTime: 'Tue Oct 06 2026 10:00:00 GMT+0000',
    metadata: { filename: 'clip.mp4', filetype: 'video/mp4', title, accessTier: 'public' },
  });

const key = (n: number, lastModified = 1700000000000) =>
  `tus::tus-br-clip.mp4-video/mp4-1000-${lastModified}-http://localhost:3000/api/v1/uploads-sluby-abc::${n}`;

const head = (offset: number) => () =>
  new Response(null, { headers: { 'Upload-Offset': String(offset), 'Upload-Length': '1000' } });

afterEach(() => vi.unstubAllGlobals());

describe('findUnfinishedUploads', () => {
  it('lists unfinished sluby uploads and forgets the ones the server dropped or finished', async () => {
    localStorage.setItem(key(1), entry('http://localhost:3000/api/v1/uploads/open', 'Open'));
    localStorage.setItem(key(2), entry('http://localhost:3000/api/v1/uploads/gone'));
    localStorage.setItem(key(3), entry('http://localhost:3000/api/v1/uploads/done'));
    // another app's tus upload on the same origin is none of our business
    localStorage.setItem('tus::tus-br-other.mp4-x::9', entry('http://localhost:3000/x'));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({
          'HEAD /api/v1/uploads/open': head(250),
          'HEAD /api/v1/uploads/gone': reply(404),
          'HEAD /api/v1/uploads/done': head(1000),
        }),
      ),
    );

    const found = await findUnfinishedUploads();

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ uploadId: 'open', title: 'Open', offset: 250, size: 1000 });
    expect(localStorage.getItem(key(1))).not.toBeNull();
    expect(localStorage.getItem(key(2))).toBeNull();
    expect(localStorage.getItem(key(3))).toBeNull();
    expect(localStorage.getItem('tus::tus-br-other.mp4-x::9')).not.toBeNull();
  });

  it('keeps an entry when the server could not answer, and reports the failure', async () => {
    localStorage.setItem(key(1), entry('http://localhost:3000/api/v1/uploads/open'));
    vi.stubGlobal(
      'fetch',
      vi.fn(jsonFetch({ 'HEAD /api/v1/uploads/open': reply(502, { error: 'bad gateway' }) })),
    );
    await expect(findUnfinishedUploads()).rejects.toThrow(/HTTP 502/);
    expect(localStorage.getItem(key(1))).not.toBeNull();
  });
});

describe('isSameFile', () => {
  it('matches only the exact file tus fingerprinted', () => {
    const upload = { storageKey: key(1) } as Parameters<typeof isSameFile>[0];
    const file = (lastModified: number, name = 'clip.mp4') =>
      new File([new Uint8Array(1000)], name, { type: 'video/mp4', lastModified });
    expect(isSameFile(upload, file(1700000000000))).toBe(true);
    expect(isSameFile(upload, file(1700000000001))).toBe(false);
    expect(isSameFile(upload, file(1700000000000, 'other.mp4'))).toBe(false);
  });
});

describe('recheckUnfinishedUpload', () => {
  it('reads the offset again, and drops an upload the server no longer has', async () => {
    localStorage.setItem(key(1), entry('http://localhost:3000/api/v1/uploads/open'));
    vi.stubGlobal('fetch', vi.fn(head(250)));
    const [u] = await findUnfinishedUploads();
    vi.stubGlobal('fetch', vi.fn(head(400)));
    expect(await recheckUnfinishedUpload(u)).toMatchObject({ offset: 400 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await recheckUnfinishedUpload(u)).toBeNull();
    expect(localStorage.getItem(key(1))).toBeNull();
    // gone from storage too: nothing to ask
    expect(await recheckUnfinishedUpload(u)).toBeNull();
  });
});
