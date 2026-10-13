// integration snippets for the developer page. the javascript ones are
// typechecked against the real @sluby/sdk and @sluby/player in
// snippets.test.ts, so a renamed sdk method breaks the build instead of the
// docs. every snippet uses the studio's own origin as the api base url.

export interface Snippet {
  id: string;
  title: string;
  description: string;
  /** Typescript; `tsx` when it renders the react player. */
  js: { lang: 'ts' | 'tsx'; code: string };
  curl: string;
}

const KEY_NOTE = '// a key from Settings > API keys, kept out of source control';

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
        'Resumable tus upload. The asset is created when the upload starts; its id comes back right away.',
      js: {
        lang: 'ts',
        code: `${client}

const file = document.querySelector<HTMLInputElement>('input[type=file]')!.files![0];

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

# 3. the created asset id is in the upload metadata
curl -s -I "$LOCATION" ${auth} -H "Tus-Resumable: 1.0.0" | grep -i upload-metadata`,
    },
    {
      id: 'processing',
      title: 'Track processing',
      description:
        'Each upload is transcoded to adaptive HLS and pinned to Sia. Poll the stage, or wait for ready.',
      js: {
        lang: 'ts',
        code: `${client}

const assetId = 'YOUR_ASSET_ID';

const job = await sluby.assets.processing(assetId);
console.log(job.stage, \`\${job.progressPercent}%\`, job.errorMessage ?? '');

// or block until the asset can play (throws if processing fails)
const asset = await sluby.assets.waitForReady(assetId, { pollInterval: 3000 });
console.log(asset.status, asset.durationMs);

// a failed asset can be re-run from the step that failed
if (job.status === 'failed') await sluby.assets.retry(assetId);`,
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
        'The player resolves the stream from the asset id, switches quality on its own, and lets you pin a rendition.',
      js: {
        lang: 'tsx',
        code: `// npm install @sluby/sdk @sluby/player
import { useRef, useState } from 'react';
import { SlubyClient } from '@sluby/sdk';
import { SlubyPlayer, type QualityLevel, type SlubyPlayerHandle } from '@sluby/player';

// browser code: use a key with only the read scope
const sluby = new SlubyClient({ baseUrl: '${base}', apiKey: 'sluby_read_only_key' });

export function Video({ assetId }: { assetId: string }) {
  const player = useRef<SlubyPlayerHandle>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);

  return (
    <>
      <SlubyPlayer ref={player} client={sluby} assetId={assetId} onQualitiesChange={setLevels} />
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
      curl: `# the hls master playlist url any player can load
curl -s "${base}/api/v1/playback/YOUR_ASSET_ID" \\
  ${auth}`,
    },
    {
      id: 'private',
      title: 'Private playback',
      description:
        'Private assets only stream through signed URLs that expire. The player signs for you with `signed`.',
      js: {
        lang: 'ts',
        code: `${client}

const { signedUrl, expiresAt } = await sluby.playback.getSignedUrl('YOUR_ASSET_ID', {
  expiresIn: 3600,
});
console.log(signedUrl, 'valid until', expiresAt);
// in React: <SlubyPlayer client={sluby} assetId="..." signed expiresIn={3600} />`,
      },
      curl: `curl -s "${base}/api/v1/playback/YOUR_ASSET_ID/signed?expires_in=3600" \\
  ${auth}`,
    },
    {
      id: 'direct',
      title: 'Stream direct from Sia',
      description:
        'With a viewer identity the player pulls bytes straight from Sia hosts; the backend only mints short-lived share URLs.',
      js: {
        lang: 'ts',
        code: `import { SlubyClient } from '@sluby/sdk';

// a publishable viewer identity from \`npm run provision-viewer --workspace=backend\`
const sluby = new SlubyClient({
  baseUrl: '${base}',
  apiKey: 'sluby_read_only_key',
  sia: {
    indexerUrl: 'https://sia.storage',
    appId: 'VIEWER_APP_ID_HEX',
    appKey: 'VIEWER_APP_KEY_HEX',
  },
});
// <SlubyPlayer client={sluby} assetId="..." onDeliveryChange={console.log} /> reports "sia"`,
      },
      curl: `# the per-object sia:// share urls the player resolves
curl -s "${base}/api/v1/playback/YOUR_ASSET_ID/share" \\
  ${auth}`,
    },
    {
      id: 'storage',
      title: 'Inspect Sia storage',
      description:
        'Every object behind an asset with its slabs, sectors, encoded size, redundancy and the hosts holding it.',
      js: {
        lang: 'ts',
        code: `const res = await fetch('${base}/api/v1/assets/YOUR_ASSET_ID/sia', {
  headers: { Authorization: \`Bearer \${process.env.SLUBY_API_KEY}\` },
});
const sia = await res.json();
console.log(sia.totals.redundancy_ratio, sia.totals.unique_slab_count, sia.countries);

const renditions = await fetch('${base}/api/v1/assets/YOUR_ASSET_ID/renditions', {
  headers: { Authorization: \`Bearer \${process.env.SLUBY_API_KEY}\` },
}).then((r) => r.json());
console.log(renditions.data);`,
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
        'Events for your own assets, signed with HMAC-SHA256 over the raw body. Verify before trusting them.',
      js: {
        lang: 'ts',
        code: `import { createServer } from 'node:http';
import { SlubyClient } from '@sluby/sdk';

const sluby = new SlubyClient({ baseUrl: '${base}', apiKey: process.env.SLUBY_API_KEY! });
const secret = process.env.SLUBY_WEBHOOK_SECRET!; // returned once when the webhook is created

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const signature = String(req.headers['x-sluby-signature'] ?? '');
    // verify the raw body exactly as it arrived, before parsing it
    if (!sluby.webhooks.verifySignature(body, signature, secret)) {
      res.writeHead(401).end();
      return;
    }
    const event = sluby.webhooks.parseEvent(body);
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
        code: `const res = await fetch('${base}/api/v1/keys/YOUR_KEY_ID/rotate', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.SLUBY_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ grace_period_seconds: 86400 }),
});
const { key, previous_key_expires_at } = await res.json();
console.log('new key (shown once):', key, 'old key ends', previous_key_expires_at);`,
      },
      curl: `curl -s -X POST "${base}/api/v1/keys/YOUR_KEY_ID/rotate" \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -d '{"grace_period_seconds": 86400}'`,
    },
  ];
}
