// SlubyClient uploads in a real browser: the browser build of tus-js-client,
// which keeps resumable upload urls in localStorage, against a real tus server
// speaking the Sluby upload contract (see tus-plugin.ts).

import { describe, it, expect, beforeEach } from 'vitest';
import { SlubyClient } from '../client.js';
import { BROWSER_API_KEY } from './contract.js';

interface Log {
  requests: Array<{ method: string; url: string; uploadOffset: number | null }>;
  created: Array<{
    uploadId: string;
    videoAssetId: string;
    metadata: Record<string, string | null>;
  }>;
  finished: string[];
}

async function log(): Promise<Log> {
  return (await (await fetch('/__tus/log')).json()) as Log;
}

function client(apiKey = BROWSER_API_KEY): SlubyClient {
  return new SlubyClient({ apiKey, baseUrl: location.origin });
}

function clip(size = 96 * 1024): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31) % 251;
  // a fixed name, type, size and date: what tus-js-client fingerprints a File by
  return new File([bytes], 'clip.mp4', { type: 'video/mp4', lastModified: 1_700_000_000_000 });
}

function storedUploads(): string[] {
  return Object.keys(localStorage).filter((k) => k.startsWith('tus::'));
}

beforeEach(async () => {
  localStorage.clear();
  await fetch('/__tus/reset', { method: 'POST' });
});

describe('uploads in a browser', () => {
  it('uploading the same file twice creates two assets with their own metadata', async () => {
    const file = clip();

    const first = client().uploads.upload(file, { title: 'first upload' });
    const firstId = await first.assetId;
    await first;
    const second = client().uploads.upload(file, { title: 'second upload, new title' });
    const secondId = await second.assetId;
    await second;

    const { requests, created, finished } = await log();
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2);
    expect(created).toHaveLength(2);
    expect(secondId).not.toBe(firstId);
    expect([firstId, secondId]).toEqual(created.map((c) => c.videoAssetId));
    expect(created.map((c) => c.metadata.title)).toEqual([
      'first upload',
      'second upload, new title',
    ]);
    expect(finished).toHaveLength(2);
    // a finished upload leaves nothing behind to resume
    expect(storedUploads()).toEqual([]);
  });

  it('the same file with the same metadata is still a new upload once the first finished', async () => {
    const file = clip();

    await client().uploads.upload(file, { title: 'same' });
    await client().uploads.upload(file, { title: 'same' });

    const { requests, created } = await log();
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2);
    expect(new Set(created.map((c) => c.videoAssetId)).size).toBe(2);
  });

  it('resumes an unfinished upload of the same file from an earlier page load', async () => {
    const file = clip(256 * 1024);

    // the first page load sends part of the file, then the tab goes away
    let stopped = false;
    const first = client().uploads.upload(file, {
      title: 'interrupted',
      chunkSize: 32 * 1024,
      onProgress: (_pct, sent) => {
        if (!stopped && sent >= 64 * 1024) {
          stopped = true;
          void first.pause();
        }
      },
    });
    const firstId = await first.assetId;
    await expect.poll(() => first.isPaused).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(storedUploads()).toHaveLength(1);
    const before = await log();
    const sentBefore = Math.max(
      ...before.requests.filter((r) => r.method === 'PATCH').map((r) => r.uploadOffset ?? 0),
    );

    // a new page load picks the same file with the same details
    const again = client().uploads.upload(file, { title: 'interrupted', chunkSize: 32 * 1024 });
    expect(await again.assetId).toBe(firstId);
    await again;

    const { requests, created, finished } = await log();
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(finished).toEqual([created[0].uploadId]);
    const resumedFrom = requests
      .slice(before.requests.length)
      .find((r) => r.method === 'PATCH')?.uploadOffset;
    expect(resumedFrom).toBeGreaterThan(0);
    expect(resumedFrom).toBeLessThanOrEqual(sentBefore + 32 * 1024);
    expect(await again.uploadId).toBe(created[0].uploadId);
    expect(storedUploads()).toEqual([]);
  });

  it('does not resume the same file under another title', async () => {
    const file = clip(256 * 1024);
    let stopped = false;
    const first = client().uploads.upload(file, {
      title: 'one',
      chunkSize: 32 * 1024,
      onProgress: () => {
        if (!stopped) {
          stopped = true;
          void first.pause();
        }
      },
    });
    await first.assetId;
    await expect.poll(() => first.isPaused).toBe(true);

    await client().uploads.upload(file, { title: 'two' });

    const { requests } = await log();
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2);
  });

  it('abort after the upload finished keeps the upload on the server', async () => {
    const upload = client().uploads.upload(clip(), { title: 'keep' });
    await upload;

    await upload.abort();
    await new Promise((r) => setTimeout(r, 200));

    const { requests, finished } = await log();
    expect(requests.map((r) => r.method)).not.toContain('DELETE');
    expect(finished).toHaveLength(1);
  });
});
