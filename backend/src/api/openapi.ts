/**
 * OpenAPI 3.1 description of the Sluby REST API and delivery gateway.
 *
 * This document is the machine-readable contract for the API. It is served
 * at `GET /api/v1/openapi.json` and rendered at `GET /api/v1/docs`, and a
 * drift-guard test (`openapi-drift.test.ts`) fails the build if a mounted
 * route is missing here or a documented path no longer exists — so the
 * spec cannot silently fall out of sync with the code.
 *
 * `x-required-scope` on an operation records the API-key scope its
 * middleware enforces (`upload` | `read` | `manage`). Auth endpoints and
 * the public spec/docs carry `security: []`.
 */

const bearerAuth = [{ bearerAuth: [] as string[] }];

// Reusable response bodies -------------------------------------------------

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
};

const jsonResponse = (ref: string, description: string) => ({
  description,
  content: {
    'application/json': { schema: { $ref: `#/components/schemas/${ref}` } },
  },
});

const idParam = (name: string, description: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' },
  description,
});

export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Sluby API',
    version: '1.0.0',
    description:
      'REST API and delivery gateway for Sluby, decentralized video streaming on ' +
      'the Sia network. Programmatic access uses a scoped API key sent as a ' +
      '`Bearer` token; the Studio UI uses a session cookie. A health probe is ' +
      'also available at `GET /health`.',
    license: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  },
  servers: [{ url: '/', description: 'This deployment' }],
  tags: [
    { name: 'Uploads', description: 'Resumable upload sessions (TUS).' },
    { name: 'Assets', description: 'Video asset lifecycle and metadata.' },
    { name: 'Playback', description: 'Playback URLs and playback IDs.' },
    { name: 'Storage', description: 'Per-asset Sia storage breakdown.' },
    { name: 'Keys', description: 'Scoped API key management.' },
    { name: 'Webhooks', description: 'Event delivery endpoints.' },
    { name: 'Reconciliation', description: 'DB vs indexer inventory drift.' },
    { name: 'Delivery', description: 'Byte-range gateway for Sia objects.' },
    { name: 'Auth', description: 'Studio session auth.' },
    { name: 'Ops', description: 'Metrics and cache.' },
  ],
  security: bearerAuth,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description:
          'A Sluby API key (`sluby_...`) sent as `Authorization: Bearer <key>`. ' +
          'Keys carry scopes: `upload`, `read`, `manage`.',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'sluby_session',
        description: 'Signed session cookie issued to the Studio after GitHub login.',
      },
    },
    parameters: {
      limit: {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        description: 'Page size (1-100).',
      },
      cursor: {
        name: 'cursor',
        in: 'query',
        schema: { type: 'string' },
        description:
          'Keyset pagination cursor. Pass the `next_cursor` from the previous ' +
          'page to fetch the next one.',
      },
      page: {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', minimum: 1, default: 1 },
        description: 'Offset page number (alternative to `cursor`).',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
          details: {},
        },
        required: ['error'],
      },
      Asset: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          manifest_object_id: { type: ['string', 'null'] },
          thumbnail_object_ids: { type: 'array', items: { type: 'string' } },
          duration_ms: { type: 'integer' },
          resolution: { type: 'string' },
          status: {
            type: 'string',
            enum: ['created', 'uploading', 'processing', 'ready', 'failed'],
          },
          access_tier: { type: 'string', enum: ['public', 'private'] },
          creator_address: { type: 'string' },
          segment_count: { type: 'integer' },
          total_storage_bytes: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      AssetList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Asset' } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          next_cursor: { type: ['string', 'null'] },
          has_more: { type: 'boolean' },
        },
        required: ['data', 'total', 'has_more'],
      },
      ProcessingStatus: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          progress_percent: { type: 'integer' },
          error_message: { type: ['string', 'null'] },
          started_at: { type: ['string', 'null'], format: 'date-time' },
          completed_at: { type: ['string', 'null'], format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
          logs: { type: 'array', items: { type: 'object' } },
        },
      },
      PlaybackInfo: {
        type: 'object',
        properties: {
          playback_url: { type: 'string' },
          poster_url: { type: ['string', 'null'] },
          duration_ms: { type: 'integer' },
          resolution: { type: 'string' },
          access_tier: { type: 'string' },
        },
      },
      SignedUrl: {
        type: 'object',
        properties: {
          signedUrl: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      PlaybackId: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          playback_id: { type: 'string', description: 'Public `pb_...` handle.' },
          policy: { type: 'string', enum: ['public', 'signed'] },
          name: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      PlaybackIdList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/PlaybackId' } },
        },
      },
      ReconciliationRun: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          started_at: { type: 'string', format: 'date-time' },
          finished_at: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['ok', 'drift'] },
          db_object_count: { type: 'integer' },
          indexer_object_count: { type: 'integer' },
          in_sync_count: { type: 'integer' },
          orphan_count: { type: 'integer' },
          missing_count: { type: 'integer' },
          orphaned_ids: { type: 'array', items: { type: 'string' } },
          missing_ids: { type: 'array', items: { type: 'string' } },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      UploadSession: {
        type: 'object',
        properties: {
          video_asset_id: { type: 'string', format: 'uuid' },
          upload_url: { type: 'string' },
        },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          key: { type: 'string', description: 'Raw key, returned only at creation.' },
          name: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
        },
      },
      SiaStorageInfo: {
        type: 'object',
        description:
          'Per-asset Sia storage breakdown: object IDs, slab/sector counts, host ' +
          'distribution and redundancy ratio.',
        additionalProperties: true,
      },
      CacheStats: {
        type: 'object',
        properties: {
          object: { type: 'object' },
          manifest: { type: 'object' },
          hits: { type: 'integer' },
          misses: { type: 'integer' },
        },
      },
    },
  },
  paths: {
    // ── Public spec / docs ──
    '/api/v1/openapi.json': {
      get: {
        tags: ['Ops'],
        summary: 'This OpenAPI document.',
        security: [],
        responses: { '200': { description: 'The OpenAPI 3.1 document.' } },
      },
    },
    '/api/v1/docs': {
      get: {
        tags: ['Ops'],
        summary: 'Interactive API reference.',
        security: [],
        responses: {
          '200': { description: 'HTML documentation page.', content: { 'text/html': {} } },
        },
      },
    },

    // ── Auth (unauthenticated) ──
    '/api/v1/auth/github/login': {
      get: { tags: ['Auth'], summary: 'Begin GitHub OAuth login.', security: [], responses: { '302': { description: 'Redirect to GitHub.' } } },
    },
    '/api/v1/auth/github/callback': {
      get: { tags: ['Auth'], summary: 'GitHub OAuth callback.', security: [], responses: { '302': { description: 'Redirect into the Studio.' } } },
    },
    '/api/v1/auth/me': {
      get: { tags: ['Auth'], summary: 'Current session identity.', security: [{ cookieAuth: [] }], responses: { '200': { description: 'Session info.' }, '401': errorResponse } },
    },
    '/api/v1/auth/logout': {
      post: { tags: ['Auth'], summary: 'Clear the session cookie.', security: [{ cookieAuth: [] }], responses: { '200': { description: 'Logged out.' } } },
    },

    // ── Uploads ──
    '/api/v1/uploads': {
      post: {
        tags: ['Uploads'],
        summary: 'Create an upload session.',
        'x-required-scope': 'upload',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  access_tier: { type: 'string', enum: ['public', 'private'] },
                },
                required: ['title'],
              },
            },
          },
        },
        responses: { '201': jsonResponse('UploadSession', 'Session created.'), '400': errorResponse },
      },
    },
    '/api/v1/uploads/{id}': {
      get: { tags: ['Uploads'], summary: 'Upload session status.', 'x-required-scope': 'read', parameters: [idParam('id', 'Upload session id.')], responses: { '200': { description: 'Session status.' }, '404': errorResponse } },
      delete: { tags: ['Uploads'], summary: 'Cancel an upload session.', 'x-required-scope': 'upload', parameters: [idParam('id', 'Upload session id.')], responses: { '200': { description: 'Cancelled.' } } },
    },

    // ── Assets ──
    '/api/v1/assets': {
      get: {
        tags: ['Assets'],
        summary: 'List assets (cursor pagination + filters).',
        'x-required-scope': 'read',
        parameters: [
          { $ref: '#/components/parameters/limit' },
          { $ref: '#/components/parameters/cursor' },
          { $ref: '#/components/parameters/page' },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status.' },
          { name: 'access_tier', in: 'query', schema: { type: 'string', enum: ['public', 'private'] } },
        ],
        responses: { '200': jsonResponse('AssetList', 'A page of assets.'), '403': errorResponse },
      },
    },
    '/api/v1/assets/{id}': {
      get: { tags: ['Assets'], summary: 'Get an asset.', 'x-required-scope': 'read', parameters: [idParam('id', 'Asset id.')], responses: { '200': jsonResponse('Asset', 'The asset.'), '404': errorResponse } },
      patch: { tags: ['Assets'], summary: 'Update asset metadata.', 'x-required-scope': 'manage', parameters: [idParam('id', 'Asset id.')], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, access_tier: { type: 'string' } } } } } }, responses: { '200': jsonResponse('Asset', 'Updated.'), '404': errorResponse } },
      delete: { tags: ['Assets'], summary: 'Delete an asset.', 'x-required-scope': 'manage', parameters: [idParam('id', 'Asset id.')], responses: { '200': { description: 'Deleted.' } } },
    },
    '/api/v1/assets/{id}/processing': {
      get: { tags: ['Assets'], summary: 'Processing status for an asset.', 'x-required-scope': 'read', parameters: [idParam('id', 'Asset id.')], responses: { '200': jsonResponse('ProcessingStatus', 'Processing status.'), '404': errorResponse } },
    },
    '/api/v1/assets/{id}/retry': {
      post: { tags: ['Assets'], summary: 'Retry a failed asset.', 'x-required-scope': 'manage', parameters: [idParam('id', 'Asset id.')], responses: { '200': { description: 'Retry enqueued.' }, '400': errorResponse } },
    },
    '/api/v1/assets/{id}/sia': {
      get: { tags: ['Storage'], summary: 'Per-asset Sia storage breakdown.', 'x-required-scope': 'read', parameters: [idParam('id', 'Asset id.')], responses: { '200': jsonResponse('SiaStorageInfo', 'Storage breakdown.'), '404': errorResponse } },
    },
    '/api/v1/assets/{id}/playback-ids': {
      post: { tags: ['Playback'], summary: 'Create a playback ID.', 'x-required-scope': 'manage', parameters: [idParam('id', 'Asset id.')], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { policy: { type: 'string', enum: ['public', 'signed'] }, name: { type: 'string' } } } } } }, responses: { '201': jsonResponse('PlaybackId', 'Created.'), '400': errorResponse, '404': errorResponse } },
      get: { tags: ['Playback'], summary: 'List playback IDs for an asset.', 'x-required-scope': 'read', parameters: [idParam('id', 'Asset id.')], responses: { '200': jsonResponse('PlaybackIdList', 'Playback IDs.') } },
    },
    '/api/v1/playback-ids/{playbackId}': {
      delete: { tags: ['Playback'], summary: 'Delete a playback ID.', 'x-required-scope': 'manage', parameters: [idParam('playbackId', 'Public pb_ handle.')], responses: { '200': { description: 'Deleted.' }, '404': errorResponse } },
    },

    // ── Playback ──
    '/api/v1/playback/{id}': {
      get: { tags: ['Playback'], summary: 'Playback info + URL for an asset or playback ID.', 'x-required-scope': 'read', parameters: [idParam('id', 'Asset UUID or pb_ playback ID.')], responses: { '200': jsonResponse('PlaybackInfo', 'Playback info.'), '404': errorResponse, '409': errorResponse } },
    },
    '/api/v1/playback/{id}/signed': {
      get: { tags: ['Playback'], summary: 'Time-limited signed playback URL.', 'x-required-scope': 'read', parameters: [idParam('id', 'Asset UUID or pb_ playback ID.'), { name: 'expires_in', in: 'query', schema: { type: 'integer', default: 3600 } }], responses: { '200': jsonResponse('SignedUrl', 'Signed URL.'), '404': errorResponse, '409': errorResponse } },
    },

    // ── Keys ──
    '/api/v1/keys': {
      post: { tags: ['Keys'], summary: 'Create an API key.', 'x-required-scope': 'manage', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: ['upload', 'read', 'manage'] } }, rate_limit: { type: 'integer' } }, required: ['name'] } } } }, responses: { '201': jsonResponse('ApiKey', 'Created (raw key shown once).'), '400': errorResponse } },
      get: { tags: ['Keys'], summary: 'List API keys.', 'x-required-scope': 'manage', responses: { '200': { description: 'Keys.' } } },
    },
    '/api/v1/keys/{id}': {
      delete: { tags: ['Keys'], summary: 'Delete an API key.', 'x-required-scope': 'manage', parameters: [idParam('id', 'Key id.')], responses: { '200': { description: 'Deleted.' } } },
    },

    // ── Webhooks ──
    '/api/v1/webhooks': {
      post: { tags: ['Webhooks'], summary: 'Register a webhook endpoint.', 'x-required-scope': 'manage', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string' }, events: { type: 'array', items: { type: 'string' } } }, required: ['url'] } } } }, responses: { '201': { description: 'Created.' }, '400': errorResponse } },
      get: { tags: ['Webhooks'], summary: 'List webhook endpoints.', 'x-required-scope': 'manage', responses: { '200': { description: 'Endpoints.' } } },
    },
    '/api/v1/webhooks/{id}': {
      delete: { tags: ['Webhooks'], summary: 'Delete a webhook endpoint.', 'x-required-scope': 'manage', parameters: [idParam('id', 'Endpoint id.')], responses: { '200': { description: 'Deleted.' } } },
    },

    // ── Reconciliation ──
    '/api/v1/reconciliation': {
      get: { tags: ['Reconciliation'], summary: 'Latest reconciliation run.', 'x-required-scope': 'manage', responses: { '200': jsonResponse('ReconciliationRun', 'Latest run.'), '404': errorResponse } },
    },
    '/api/v1/reconciliation/run': {
      post: { tags: ['Reconciliation'], summary: 'Trigger a reconciliation run.', 'x-required-scope': 'manage', responses: { '202': { description: 'Enqueued.' } } },
    },

    // ── Ops ──
    '/api/v1/metrics': {
      get: { tags: ['Ops'], summary: 'Platform metrics (JSON).', responses: { '200': { description: 'Metrics.' } } },
    },

    // ── Delivery gateway ──
    '/v1/objects/{objectId}': {
      get: {
        tags: ['Delivery'],
        summary: 'Stream a Sia object, with byte-range support.',
        security: [],
        parameters: [
          idParam('objectId', 'Sia object ID.'),
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['manifest', 'playlist', 'thumbnail', 'video', 'segment', 'data'] }, description: 'Content-type hint.' },
          { name: 'Range', in: 'header', schema: { type: 'string' }, description: 'Byte range, e.g. `bytes=0-1023`.' },
        ],
        responses: {
          '200': { description: 'Full object.' },
          '206': { description: 'Partial content (range).' },
          '416': { description: 'Range not satisfiable.' },
          '404': errorResponse,
        },
      },
    },
    '/v1/stream/{videoAssetId}/master.m3u8': {
      get: { tags: ['Delivery'], summary: 'Master HLS manifest for an asset or playback ID.', security: [], parameters: [idParam('videoAssetId', 'Asset UUID or pb_ playback ID.')], responses: { '200': { description: 'HLS manifest.', content: { 'application/vnd.apple.mpegurl': {} } }, '404': errorResponse } },
    },
    '/v1/cache/stats': {
      get: { tags: ['Ops'], summary: 'Delivery cache statistics.', security: [], responses: { '200': jsonResponse('CacheStats', 'Cache stats.') } },
    },
  },
} as const;

export type OpenApiDocument = typeof openapiDocument;
