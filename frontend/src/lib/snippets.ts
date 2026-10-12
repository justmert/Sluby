// integration snippets for the quickstart page. the javascript ones are
// typechecked against the real @sluby/sdk and @sluby/player in
// snippets.test.ts, and every url, query and body in them is checked against
// the openapi document in api-paths.test.ts, so a renamed sdk method or
// field breaks the build instead of the docs. every snippet uses the
// studio's own origin as the api base url, and the video id the page picked
// (YOUR_VIDEO_ID until there is a ready video). the play snippets come from
// lib/embed.ts, so the quickstart and the share panel hand out the same code.

import { SETUP_DESCRIPTION } from './snippet-copy';

export interface Snippet {
  id: string;
  title: string;
  description: string;
  /** Which key scope the calls need, when the usual upload and read key is not enough. */
  scopeNote?: string;
  /** Typescript; `tsx` when it renders the react player. */
  js: { lang: 'ts' | 'tsx'; code: string };
  curl: string;
}

const KEY_NOTE =
  '// server-side only: use a key from the API keys page. Keep it out of source control\n// and out of the browser.';

/** What stands in the snippets until a ready video is picked. */
export const VIDEO_ID_PLACEHOLDER = 'YOUR_VIDEO_ID';

export const MANAGE_SCOPE_NOTE = 'Needs a key with the manage scope.';

/** A node server that checks a webhook's signature; the webhook page shows it too. */
export const RECEIVE_WEBHOOKS = `import { createServer } from 'node:http';
import { WebhookManager } from '@sluby/sdk';

// checking a signature needs no api key, only the webhook's signing secret
const webhooks = new WebhookManager();
const secret = process.env.SLUBY_WEBHOOK_SECRET!; // shown once when the webhook is added

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    // decode once at the end: a character can be split across chunks
    const body = Buffer.concat(chunks).toString('utf8');
    // checks X-Sluby-Signature-V1 over the raw body and refuses old timestamps
    if (!webhooks.verifyRequest(body, req.headers, secret)) {
      res.writeHead(401).end();
      return;
    }
    const event = webhooks.parseEvent(body);
    console.log(event.event, event.data);
    res.writeHead(204).end();
  });
}).listen(8080);`;

export function buildSnippets(baseUrl: string, videoId = VIDEO_ID_PLACEHOLDER): Snippet[] {
  const base = baseUrl.replace(/\/+$/, '');
  const id = videoId;
  const client = `import { SlubyClient } from '@sluby/sdk';

${KEY_NOTE}
const sluby = new SlubyClient({
  baseUrl: '${base}',
  apiKey: process.env.SLUBY_API_KEY!,
});`;
  const auth = '-H "Authorization: Bearer $SLUBY_API_KEY"';

  return [
    {
      id: 'setup',
      title: 'Set up',
      description: SETUP_DESCRIPTION,
      js: {
        lang: 'ts',
        code: `// npm install @sluby/sdk
${client}

const { total } = await sluby.assets.list({ limit: 1 });
console.log(\`\${total} videos in the library\`);`,
      },
      curl: `export SLUBY_API_KEY=sluby_your_key

curl -s "${base}/api/v1/assets?limit=1" \\
  ${auth}`,
    },
    {
      id: 'upload',
      title: 'Upload',
      description:
        'A resumable upload from your server. The video (an asset in the API) is created when the upload starts, and its ID comes back at once.',
      js: {
        lang: 'ts',
        code: `import { openAsBlob } from 'node:fs';
${client}

const file = await openAsBlob('video.mp4', { type: 'video/mp4' });

const upload = sluby.uploads.upload(file, {
  title: 'My video',
  accessTier: 'public',
  onProgress: (percent, sent, total) => console.log(\`\${percent}% (\${sent}/\${total} bytes)\`),
});
// upload.pause(); upload.resume(); upload.abort();

const assetId = await upload.assetId;
await upload; // resolves once every byte is on the server
console.log('uploaded', assetId);`,
      },
      curl: `# 1. create the upload; metadata values are base64
LOCATION=$(curl -s -D - -o /dev/null -X POST "${base}/api/v1/uploads" \\
  ${auth} \\
  -H "Tus-Resumable: 1.0.0" \\
  -H "Upload-Length: $(wc -c < video.mp4 | tr -d ' ')" \\
  -H "Upload-Metadata: filename $(printf video.mp4 | base64),filetype $(printf video/mp4 | base64),title $(printf 'My video' | base64)" \\
  | awk 'tolower($1)=="location:" {print $2}' | tr -d '\\r')

# 2. send the bytes
curl -s -X PATCH "$LOCATION" \\
  ${auth} \\
  -H "Tus-Resumable: 1.0.0" \\
  -H "Upload-Offset: 0" \\
  -H "Content-Type: application/offset+octet-stream" \\
  --data-binary @video.mp4

# 3. read the created video id, the base64 videoAssetId entry of the upload metadata
curl -s -I "$LOCATION" \\
  ${auth} \\
  -H "Tus-Resumable: 1.0.0" \\
  | grep -i '^upload-metadata:' | tr -d '\\r' | cut -d ' ' -f 2- | tr ',' '\\n' \\
  | awk '$1 == "videoAssetId" {print $2}' | base64 -d; echo`,
    },
    {
      id: 'processing',
      title: 'Track',
      description:
        'Each upload is converted for streaming and stored on Sia. Check its progress, or wait until it is ready. Retrying a failed video needs the manage scope.',
      scopeNote: MANAGE_SCOPE_NOTE,
      js: {
        lang: 'ts',
        code: `${client.replace("import { SlubyClient } from '@sluby/sdk';", "import { ProcessingFailedError, SlubyClient } from '@sluby/sdk';")}

const assetId = '${id}';

const job = await sluby.assets.processing(assetId);
console.log(job.stage, \`\${job.progressPercent}%\`, job.errorMessage ?? '');

// or wait until the video can play
try {
  const asset = await sluby.assets.waitForReady(assetId, { pollInterval: 3000 });
  console.log(asset.status, asset.durationMs);
} catch (err) {
  if (!(err instanceof ProcessingFailedError)) throw err;
  // a failed video can be run again from the step that failed
  const { stage } = await sluby.assets.retry(assetId);
  console.log('retrying from', stage);
}`,
      },
      curl: `curl -s "${base}/api/v1/assets/${id}/processing" \\
  ${auth}

# retry a failed video (manage scope)
curl -s -X POST "${base}/api/v1/assets/${id}/retry" \\
  ${auth}`,
    },
    {
      id: 'library',
      title: 'Search',
      description: 'Search, filter and sort your videos on the server, a page at a time.',
      js: {
        lang: 'ts',
        code: `${client}

const page = await sluby.assets.list({
  search: 'keynote',
  status: 'ready',
  sort: 'created_at',
  order: 'desc',
  page: 1,
  limit: 20,
});
for (const asset of page.data) console.log(asset.id, asset.title, asset.durationMs);`,
      },
      curl: `curl -s "${base}/api/v1/assets?search=keynote&status=ready&sort=created_at&order=desc&page=1&limit=20" \\
  ${auth}`,
    },
    {
      id: 'private',
      title: 'Private',
      description:
        'Private videos only stream through signed URLs that expire. Sign them on your server, since a read key can sign any of your videos, and give the signed URL to the player as src.',
      js: {
        lang: 'ts',
        code: `${client}

const { signedUrl, expiresAt } = await sluby.playback.getSignedUrl('${id}', {
  expiresIn: 3600,
});
// send signedUrl to the page; it plays until expiresAt
console.log(signedUrl, 'valid until', expiresAt);`,
      },
      curl: `curl -s "${base}/api/v1/playback/${id}/signed?expires_in=3600" \\
  ${auth}`,
    },
    {
      id: 'direct',
      title: 'Direct from Sia',
      description:
        'With a viewer identity, the player streams straight from Sia hosts and needs no API key. This server only hands out short-lived links.',
      js: {
        lang: 'ts',
        code: `import { SlubyClient } from '@sluby/sdk';

// a publishable viewer identity from \`npm run provision-viewer --workspace=backend\`
const sluby = new SlubyClient({
  baseUrl: '${base}',
  sia: {
    indexerUrl: 'https://sia.storage',
    appId: 'VIEWER_APP_ID_HEX',
    appKey: 'VIEWER_APP_KEY_HEX',
  },
});
const id = '${id}';
// <SlubyPlayer src={sluby.playback.streamUrl(id)} client={sluby} assetId={id}
//   onDeliveryChange={console.log} /> reports "sia"; for a private video pass
//   the signed url your server minted as src
console.log(sluby.playback.streamUrl(id));`,
      },
      curl: `# the per-file sia:// share urls the player resolves, public for a public video
curl -s "${base}/v1/share/${id}"`,
    },
    {
      id: 'storage',
      title: 'Storage',
      description:
        'Every Sia file behind a video, with its redundancy and the hosts holding it, and the qualities made from it.',
      js: {
        lang: 'ts',
        code: `${KEY_NOTE}
const headers = { Authorization: \`Bearer \${process.env.SLUBY_API_KEY}\` };

const res = await fetch('${base}/api/v1/assets/${id}/sia', { headers });
const sia: {
  totals: { redundancy_ratio: number | null; unique_slab_count: number; host_count: number };
  countries: { country_code: string; hosts: number }[];
} = await res.json();
console.log(sia.totals.redundancy_ratio, sia.totals.unique_slab_count, sia.countries);

const listed = await fetch('${base}/api/v1/assets/${id}/renditions', { headers });
const renditions: {
  data: { name: string; video_bitrate_kbps: number | null; byte_size: number }[];
} = await listed.json();
for (const r of renditions.data) console.log(r.name, r.video_bitrate_kbps, r.byte_size);`,
      },
      curl: `curl -s "${base}/api/v1/assets/${id}/sia" \\
  ${auth}

curl -s "${base}/api/v1/assets/${id}/renditions" \\
  ${auth}`,
    },
    {
      id: 'webhooks',
      title: 'Webhooks',
      description:
        'Events for your own videos, signed with HMAC-SHA256 over a timestamp and the raw body. Check the signature before you trust one. Adding a webhook needs the manage scope.',
      scopeNote: MANAGE_SCOPE_NOTE,
      js: {
        lang: 'ts',
        code: RECEIVE_WEBHOOKS,
      },
      curl: `curl -s -X POST "${base}/api/v1/webhooks" \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/sluby-hook", "events": ["asset.ready", "asset.errored"]}'`,
    },
  ];
}
