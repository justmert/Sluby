// upload a video from a server, where an upload-scoped api key is safe to keep.
//
//   SLUBY_BASE_URL=http://localhost:8080 SLUBY_API_KEY=sluby_... \
//     node server/upload.mjs ./video.mp4 "My video"

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { SlubyClient } from '@sluby/sdk';

const [path, title] = process.argv.slice(2);
const apiKey = process.env.SLUBY_API_KEY;
if (!path || !apiKey) {
  console.error('usage: SLUBY_API_KEY=sluby_... node server/upload.mjs <file> [title]');
  process.exit(1);
}

const client = new SlubyClient({
  apiKey,
  baseUrl: process.env.SLUBY_BASE_URL ?? 'http://localhost:8080',
});

// in node the sdk uploads a Buffer, so the whole file is read into memory
const file = await readFile(path);
const upload = client.uploads.upload(file, {
  title: title ?? basename(path),
  accessTier: 'public',
  onProgress: (percent) => console.log(`uploaded ${percent}%`),
});

const assetId = await upload.assetId;
console.log(`asset ${assetId} created`);
await upload;

console.log('processing (transcode, then store on Sia)');
const asset = await client.assets.waitForReady(assetId, {
  pollInterval: 5000,
  timeout: 30 * 60_000,
});
const { playbackUrl } = await client.playback.getUrl(asset.id);
console.log(`ready: ${asset.resolution}, ${asset.durationMs} ms`);
console.log(`playback url: ${playbackUrl}`);
