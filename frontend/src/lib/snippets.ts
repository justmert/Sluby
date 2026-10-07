// integration snippets for the developer page. the javascript ones are
// typechecked against the real @sluby/sdk and @sluby/player in
// snippets.test.ts, and every url, query and body in them is checked against
// the openapi document in api-paths.test.ts, so a renamed sdk method or
// field breaks the build instead of the docs. every snippet uses the
// studio's own origin as the api base url.

export interface Snippet {
  id: string;
  title: string;
  description: string;
  /** Typescript; `tsx` when it renders the react player. */
  js: { lang: 'ts' | 'tsx'; code: string };
  curl: string;
}

const KEY_NOTE =
  '// server-side code: a key from Settings > API keys, kept out of source control and\n// never sent to a browser';

export function buildSnippets(baseUrl: string): Snippet[] {
  const base = baseUrl.replace(/\/+$/, '');
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
      description: 'Install the SDK and create a client. Every request carries your API key.',
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
      title: 'Upload a video',
      description:
        'Resumable tus upload from your server. The asset is created when the upload starts; its id comes back right away.',
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

# 3. read the created asset id, the base64 videoAssetId entry of the upload metadata
curl -s -I "$LOCATION" \\
  ${auth} \\
  -H "Tus-Resumable: 1.0.0" \\
  | grep -i '^upload-metadata:' | tr -d '\\r' | cut -d ' ' -f 2- | tr ',' '\\n' \\
  | awk '$1 == "videoAssetId" {print $2}' | base64 -d; echo`,
    },
    {
      id: 'processing',
      title: 'Track processing',
      description:
        'Each upload is transcoded to adaptive HLS and pinned to Sia. Poll the stage, or wait for ready.',
      js: {
        lang: 'ts',
        code: `${client.replace("import { SlubyClient } from '@sluby/sdk';", "import { ProcessingFailedError, SlubyClient } from '@sluby/sdk';")}

const assetId = 'YOUR_ASSET_ID';

const job = await sluby.assets.processing(assetId);
console.log(job.stage, \`\${job.progressPercent}%\`, job.errorMessage ?? '');

// or wait until the asset can play
try {
  const asset = await sluby.assets.waitForReady(assetId, { pollInterval: 3000 });
  console.log(asset.status, asset.durationMs);
} catch (err) {
  if (!(err instanceof ProcessingFailedError)) throw err;
  // a failed asset can be re-run from the step that failed
  const { stage } = await sluby.assets.retry(assetId);
  console.log('retrying from', stage);
}`,
      },
      curl: `curl -s "${base}/api/v1/assets/YOUR_ASSET_ID/processing" \\
  ${auth}

# retry a failed asset
curl -s -X POST "${base}/api/v1/assets/YOUR_ASSET_ID/retry" \\
  ${auth}`,
    },
    {
      id: 'library',
      title: 'Search the library',
      description: 'Search, filter and sort on the server, with page-based paging.',
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
      id: 'player',
      title: 'Play it in React',
      description:
        'The player plays the public stream url with no key, switches quality on its own, and lets you pin a rendition.',
      js: {
        lang: 'tsx',
        code: `// npm install @sluby/sdk @sluby/player
import { useRef, useState } from 'react';
import { SlubyClient } from '@sluby/sdk';
import { SlubyPlayer, type QualityLevel, type SlubyPlayerHandle } from '@sluby/player';

// browser code: public playback needs no api key
const sluby = new SlubyClient({ baseUrl: '${base}' });

export function Video({ assetId }: { assetId: string }) {
  const player = useRef<SlubyPlayerHandle>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);

  return (
    <>
      <SlubyPlayer
        ref={player}
        src={sluby.playback.streamUrl(assetId)}
        client={sluby}
        assetId={assetId}
        onQualitiesChange={setLevels}
      />
      <button onClick={() => player.current?.setQuality(-1)}>Auto</button>
      {levels.map((level) => (
        <button key={level.index} onClick={() => player.current?.setQuality(level.index)}>
          {level.name}
        </button>
      ))}
    </>
  );
}`,
      },
      curl: `# the hls master playlist any player can load, no key needed for a public asset
curl -s "${base}/v1/stream/YOUR_ASSET_ID/master.m3u8"`,
    },
    {
      id: 'private',
      title: 'Private playback',
      description:
        'Private assets only stream through signed URLs that expire. Sign on your server: a read key lists your library and signs any of your assets, so it must never reach a browser. Hand the signed URL to the player as src.',
      js: {
        lang: 'ts',
        code: `${client}

const { signedUrl, expiresAt } = await sluby.playback.getSignedUrl('YOUR_ASSET_ID', {
  expiresIn: 3600,
});
// send signedUrl to the page; it plays until expiresAt
console.log(signedUrl, 'valid until', expiresAt);`,
      },
      curl: `curl -s "${base}/api/v1/playback/YOUR_ASSET_ID/signed?expires_in=3600" \\
  ${auth}`,
    },
    {
      id: 'direct',
      title: 'Stream direct from Sia',
      description:
        'With a viewer identity the player pulls bytes straight from Sia hosts, no API key needed; the backend only mints short-lived share URLs.',
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
// <SlubyPlayer src={sluby.playback.streamUrl(id)} client={sluby} assetId={id}
//   onDeliveryChange={console.log} /> reports "sia"; for a private asset pass
//   the signed url your server minted as src`,
      },
      curl: `# the per-object sia:// share urls the player resolves, public for a public asset
curl -s "${base}/v1/share/YOUR_ASSET_ID"`,
    },
    {
      id: 'storage',
      title: 'Inspect Sia storage',
      description:
        'Every object behind an asset with its slabs, sectors, encoded size, redundancy and the hosts holding it.',
      js: {
        lang: 'ts',
        code: `${KEY_NOTE}
const headers = { Authorization: \`Bearer \${process.env.SLUBY_API_KEY}\` };

const res = await fetch('${base}/api/v1/assets/YOUR_ASSET_ID/sia', { headers });
const sia: {
  totals: { redundancy_ratio: number | null; unique_slab_count: number; host_count: number };
  countries: { country_code: string; hosts: number }[];
} = await res.json();
console.log(sia.totals.redundancy_ratio, sia.totals.unique_slab_count, sia.countries);

const listed = await fetch('${base}/api/v1/assets/YOUR_ASSET_ID/renditions', { headers });
const renditions: {
  data: { name: string; video_bitrate_kbps: number | null; byte_size: number }[];
} = await listed.json();
for (const r of renditions.data) console.log(r.name, r.video_bitrate_kbps, r.byte_size);`,
      },
      curl: `curl -s "${base}/api/v1/assets/YOUR_ASSET_ID/sia" \\
  ${auth}

curl -s "${base}/api/v1/assets/YOUR_ASSET_ID/renditions" \\
  ${auth}`,
    },
    {
      id: 'webhooks',
      title: 'Receive webhooks',
      description:
        'Events for your own assets, signed with HMAC-SHA256 over a timestamp and the raw body. Verify before trusting them.',
      js: {
        lang: 'ts',
        code: `import { createServer } from 'node:http';
import { WebhookManager } from '@sluby/sdk';

// verifying needs no api key, only the endpoint's signing secret
const webhooks = new WebhookManager();
const secret = process.env.SLUBY_WEBHOOK_SECRET!; // returned once when the webhook is created

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
}).listen(8080);`,
      },
      curl: `curl -s -X POST "${base}/api/v1/webhooks" \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/sluby-hook", "events": ["asset.ready", "asset.errored"]}'`,
    },
    {
      id: 'keys',
      title: 'Rotate a key',
      description:
        'Issue a new secret and keep the old one working for a grace period while deployments switch.',
      js: {
        lang: 'ts',
        code: `${KEY_NOTE}
const res = await fetch('${base}/api/v1/keys/YOUR_KEY_ID/rotate', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.SLUBY_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ grace_period_seconds: 86400 }),
});
const rotated: { key: string; previous_key_expires_at: string } = await res.json();
console.log('new key (shown once):', rotated.key, 'old key ends', rotated.previous_key_expires_at);`,
      },
      curl: `curl -s -X POST "${base}/api/v1/keys/YOUR_KEY_ID/rotate" \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -d '{"grace_period_seconds": 86400}'`,
    },
  ];
}
