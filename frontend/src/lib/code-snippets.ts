// ---------------------------------------------------------------------------
// Code snippets for the Developer page
// ---------------------------------------------------------------------------

export function createApiKey() {
  return {
    curl: `curl -X POST http://localhost:3000/api/v1/keys \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my-app-key",
    "scopes": ["upload", "read", "manage"],
    "rate_limit": 100
  }'`,
    sdk: `import { SlubyClient } from '@sluby/sdk';

const client = new SlubyClient({
  apiKey: 'YOUR_API_KEY',
  baseUrl: 'http://localhost:3000',
});

const key = await client.createApiKey({
  name: 'my-app-key',
  scopes: ['upload', 'read', 'manage'],
  rateLimit: 100,
});
console.log('New key:', key.key);`,
  };
}

export function webhook() {
  return {
    curl: `curl -X POST http://localhost:3000/api/v1/webhooks \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-app.com/webhooks/sluby",
    "events": [
      "upload.completed",
      "processing.progress",
      "asset.ready",
      "asset.errored"
    ]
  }'`,
    sdk: `const webhook = await client.createWebhook({
  url: 'https://your-app.com/webhooks/sluby',
  events: [
    'upload.completed',
    'processing.progress',
    'asset.ready',
    'asset.errored',
  ],
});
console.log('Webhook secret:', webhook.secret);`,
  };
}

export function webhookVerify() {
  return {
    node: `import crypto from 'node:crypto';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

// In your Express handler:
app.post('/webhooks/sluby', (req, res) => {
  const signature = req.headers['x-sluby-signature'];
  const isValid = verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    process.env.WEBHOOK_SECRET,
  );
  if (!isValid) return res.status(401).send('Invalid signature');
  // Handle event...
  res.sendStatus(200);
});`,
  };
}

export function rateLimitHeaders() {
  return {
    description: `Rate limit information is returned in response headers:

X-RateLimit-Limit: 100        # Max requests per window
X-RateLimit-Remaining: 95     # Remaining requests
X-RateLimit-Reset: 1700000000 # Window reset timestamp (Unix)
Retry-After: 30               # Seconds until retry (when limited)

When rate-limited, the API returns HTTP 429 Too Many Requests.`,
  };
}

export function uploadVideo() {
  return {
    curl: `# Step 1: Create upload session
curl -X POST http://localhost:3000/api/v1/uploads \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "My Video",
    "description": "A great video",
    "access_tier": "public"
  }'

# Step 2: Upload file via TUS protocol
# Use tus-js-client or any TUS client with the returned upload_url`,
    sdk: `const result = await client.createUpload({
  title: 'My Video',
  description: 'A great video',
  accessTier: 'public',
});

// Upload file using TUS
await client.uploadFile(file, result.uploadUrl, {
  chunkSize: 10 * 1024 * 1024,
  onProgress: (percent) => console.log(\`\${percent}%\`),
});

// Poll for processing completion
const asset = await client.waitForReady(result.videoAssetId);`,
  };
}

export function listAssets() {
  return {
    curl: `curl http://localhost:3000/api/v1/assets?page=1&limit=20&status=ready \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    sdk: `const { data, total, page, limit } = await client.listAssets({
  page: 1,
  limit: 20,
  status: 'ready',
  accessTier: 'public',
});

for (const asset of data) {
  console.log(asset.title, asset.status, asset.resolution);
}`,
  };
}

export function getPlayback() {
  return {
    curl: `curl http://localhost:3000/api/v1/playback/ASSET_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    sdk: `const playback = await client.getPlayback('ASSET_ID');
console.log('HLS URL:', playback.playbackUrl);
console.log('Poster:', playback.posterUrl);
console.log('Duration:', playback.durationMs, 'ms');`,
  };
}

export function processingWaitForReady() {
  return {
    sdk: `// Poll until asset is ready
const asset = await client.waitForReady(videoAssetId, {
  interval: 2000,
  timeout: 300000,
  onProgress: (job) => {
    console.log(\`Processing: \${job.progress_percent}%\`);
  },
});

console.log('Asset ready!', asset.resolution);`,
  };
}

export function metricsPrometheus() {
  return {
    curl: `# JSON format (for dashboards)
curl http://localhost:3000/api/v1/metrics?format=json \\
  -H "Authorization: Bearer YOUR_API_KEY"

# Prometheus text format (for Prometheus scraping)
curl http://localhost:3000/metrics`,
  };
}

// ---------------------------------------------------------------------------
// API Explorer templates
// ---------------------------------------------------------------------------

export interface SdkTemplate {
  label: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: string;
  category: string;
}

export const sdkTemplates: SdkTemplate[] = [
  // Assets
  {
    label: 'List Assets',
    method: 'GET',
    path: '/api/v1/assets?page=1&limit=20',
    category: 'Assets',
  },
  {
    label: 'Get Asset',
    method: 'GET',
    path: '/api/v1/assets/:id',
    category: 'Assets',
  },
  {
    label: 'Update Asset',
    method: 'PATCH',
    path: '/api/v1/assets/:id',
    body: JSON.stringify({ title: 'Updated Title', description: 'Updated description' }, null, 2),
    category: 'Assets',
  },
  {
    label: 'Delete Asset',
    method: 'DELETE',
    path: '/api/v1/assets/:id',
    category: 'Assets',
  },
  {
    label: 'Get Processing Status',
    method: 'GET',
    path: '/api/v1/assets/:id/processing',
    category: 'Assets',
  },

  // Uploads
  {
    label: 'Create Upload Session',
    method: 'POST',
    path: '/api/v1/uploads',
    body: JSON.stringify(
      { title: 'My Video', description: 'A test video', access_tier: 'public' },
      null,
      2,
    ),
    category: 'Uploads',
  },
  {
    label: 'Get Upload Status',
    method: 'GET',
    path: '/api/v1/uploads/:id',
    category: 'Uploads',
  },
  {
    label: 'Cancel Upload',
    method: 'DELETE',
    path: '/api/v1/uploads/:id',
    category: 'Uploads',
  },

  // Playback
  {
    label: 'Get Playback Info',
    method: 'GET',
    path: '/api/v1/playback/:id',
    category: 'Playback',
  },
  {
    label: 'Get Signed Playback URL',
    method: 'GET',
    path: '/api/v1/playback/:id/signed?expires_in=3600',
    category: 'Playback',
  },

  // API Keys
  {
    label: 'List API Keys',
    method: 'GET',
    path: '/api/v1/keys',
    category: 'Keys',
  },
  {
    label: 'Create API Key',
    method: 'POST',
    path: '/api/v1/keys',
    body: JSON.stringify(
      { name: 'test-key', scopes: ['upload', 'read', 'manage'], rate_limit: 100 },
      null,
      2,
    ),
    category: 'Keys',
  },
  {
    label: 'Delete API Key',
    method: 'DELETE',
    path: '/api/v1/keys/:id',
    category: 'Keys',
  },

  // Webhooks
  {
    label: 'List Webhooks',
    method: 'GET',
    path: '/api/v1/webhooks',
    category: 'Webhooks',
  },
  {
    label: 'Register Webhook',
    method: 'POST',
    path: '/api/v1/webhooks',
    body: JSON.stringify(
      {
        url: 'https://example.com/webhook',
        events: ['upload.completed', 'asset.ready'],
      },
      null,
      2,
    ),
    category: 'Webhooks',
  },
  {
    label: 'Delete Webhook',
    method: 'DELETE',
    path: '/api/v1/webhooks/:id',
    category: 'Webhooks',
  },

  // Metrics
  {
    label: 'Get Metrics (JSON)',
    method: 'GET',
    path: '/api/v1/metrics?format=json',
    category: 'Metrics',
  },

  // Health
  {
    label: 'Health Check',
    method: 'GET',
    path: '/health',
    category: 'System',
  },
];
