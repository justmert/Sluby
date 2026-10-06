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
          status: {
            type: 'string',
            enum: ['queued', 'processing', 'completed', 'failed', 'retrying'],
          },
          stage: {
            type: 'string',
            enum: ['queued', 'transcode', 'upload', 'finalize', 'completed', 'failed'],
            description: 'Pipeline step, from the latest stage-tagged log line.',
          },
          progress_percent: { type: 'integer' },
          retry_count: { type: 'integer' },
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
          signed_url: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time' },
        },
      },
      SharePlaybackInfo: {
        type: 'object',
        properties: {
          master_object_id: { type: 'string', description: 'The HLS master object id (hex).' },
          shares: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'Map of Sia object id (hex) to a short-lived sia:// share URL the ' +
              'browser player resolves + downloads directly, no backend proxy.',
          },
          expires_at: { type: 'string', format: 'date-time' },
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
        description:
          'The counts, status and timestamps cover the whole deployment for every caller. ' +
          'The object ids depend on `scope`: a tenant (`account`) gets only the missing ids ' +
          'of its own assets and no orphaned ids, since an orphan belongs to no asset; the ' +
          'platform identity (`deployment`) gets every id.',
        required: [
          'id',
          'started_at',
          'finished_at',
          'status',
          'db_object_count',
          'indexer_object_count',
          'in_sync_count',
          'orphan_count',
          'missing_count',
          'error_message',
          'created_at',
          'scope',
          'missing_ids',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          started_at: { type: 'string', format: 'date-time' },
          finished_at: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['ok', 'drift', 'failed'] },
          db_object_count: { type: 'integer', description: 'Deployment-wide.' },
          indexer_object_count: { type: 'integer', description: 'Deployment-wide.' },
          in_sync_count: { type: 'integer', description: 'Deployment-wide.' },
          orphan_count: { type: 'integer', description: 'Deployment-wide.' },
          missing_count: { type: 'integer', description: 'Deployment-wide.' },
          error_message: { type: ['string', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
          scope: {
            type: 'string',
            enum: ['account', 'deployment'],
            description:
              '`account` when the ids below are limited to the caller, `deployment` for the ' +
              'platform identity.',
          },
          account_missing_count: {
            type: 'integer',
            description: "Missing objects of the caller's own assets. Only when scope is account.",
          },
          missing_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Tracked by an asset, absent from the indexer. The caller's own when scope is " +
              'account, all of them when it is deployment.',
          },
          orphaned_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Pinned on the indexer, tracked by no asset. Only when scope is deployment.',
          },
        },
      },
      ReconciliationTrigger: {
        type: 'object',
        required: ['enqueued', 'already_pending'],
        properties: {
          enqueued: { type: 'boolean', description: 'A new run was queued.' },
          already_pending: {
            type: 'boolean',
            description:
              'A run was already waiting or running, so nothing new was queued. It covers ' +
              'scheduled runs as well as manual ones.',
          },
        },
      },
      AssetStats: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          by_status: {
            type: 'object',
            properties: {
              created: { type: 'integer' },
              uploading: { type: 'integer' },
              processing: { type: 'integer' },
              ready: { type: 'integer' },
              failed: { type: 'integer' },
            },
          },
          stored_bytes: {
            type: 'integer',
            description: 'Bytes stored on Sia for these assets, before erasure coding.',
          },
          ready_duration_ms: { type: 'integer' },
          object_count: { type: 'integer', description: 'Sia objects backing these assets.' },
        },
      },
      Probe: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          latency_ms: { type: 'integer' },
          error: { type: 'string' },
        },
      },
      SystemStatus: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
          checked_at: { type: 'string', format: 'date-time' },
          version: { type: 'string' },
          uptime_seconds: { type: 'integer' },
          database: { $ref: '#/components/schemas/Probe' },
          redis: { $ref: '#/components/schemas/Probe' },
          indexer: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              latency_ms: { type: 'integer' },
              error: { type: 'string' },
              url: { type: 'string' },
              network: { type: 'string' },
              account: {
                type: ['object', 'null'],
                properties: {
                  account_key: { type: 'string' },
                  ready: { type: 'boolean' },
                  app_name: { type: 'string' },
                  pinned_data: { type: 'integer' },
                  pinned_size: { type: 'integer' },
                  max_pinned_data: { type: 'integer' },
                  remaining_storage: { type: 'integer' },
                  last_used: { type: 'string', format: 'date-time' },
                },
              },
              hosts: {
                type: ['object', 'null'],
                properties: {
                  total: { type: 'integer' },
                  good_for_upload: { type: 'integer' },
                  countries: { type: 'integer' },
                },
              },
            },
          },
          reconciliation: {
            type: ['object', 'null'],
            properties: {
              status: { type: 'string', enum: ['ok', 'drift', 'failed'] },
              finished_at: { type: 'string', format: 'date-time' },
              in_sync_count: { type: 'integer' },
              orphan_count: { type: 'integer' },
              missing_count: { type: 'integer' },
            },
          },
          cache: {
            type: 'object',
            properties: {
              hits: { type: 'integer' },
              misses: { type: 'integer' },
              object_bytes: { type: 'integer' },
              object_max_bytes: { type: 'integer' },
              object_items: { type: 'integer' },
              manifest_items: { type: 'integer' },
            },
          },
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
          scopes: { type: 'array', items: { type: 'string', enum: ['upload', 'read', 'manage'] } },
          rate_limit: { type: 'integer' },
          is_active: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          expires_at: {
            type: ['string', 'null'],
            format: 'date-time',
            description: 'Set while a rotated-out key is in its grace period.',
          },
        },
      },
      SiaStorageInfo: {
        type: 'object',
        description:
          'Per-asset Sia storage breakdown from the indexer. Objects packed into the same ' +
          'slab share it; totals count each slab and sector once.',
        properties: {
          manifest_object_id: { type: ['string', 'null'] },
          objects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                object_id: { type: 'string' },
                role: {
                  type: ['string', 'null'],
                  enum: [
                    'master_manifest',
                    'variant_playlist',
                    'rendition_data',
                    'thumbnail',
                    null,
                  ],
                },
                rendition: { type: ['string', 'null'] },
                size: { type: 'integer' },
                encoded_size: {
                  type: 'integer',
                  description:
                    'Encoded size of the slabs it references; shared slabs counted in full.',
                },
                slab_count: { type: 'integer' },
                sector_count: { type: 'integer' },
                shared_slab_count: { type: 'integer' },
                host_count: { type: 'integer' },
                created_at: { type: 'string', format: 'date-time' },
              },
            },
          },
          unavailable_object_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Objects the indexer could not describe on this request.',
          },
          totals: {
            type: 'object',
            properties: {
              object_count: { type: 'integer' },
              raw_bytes: { type: 'integer' },
              encoded_bytes: {
                type: 'integer',
                description: 'Bytes on hosts after erasure coding, each unique slab once.',
              },
              unique_slab_count: { type: 'integer' },
              unique_sector_count: { type: 'integer' },
              sector_bytes: { type: 'integer', description: 'Unique sectors x 4 MiB.' },
              data_shards: { type: ['integer', 'null'] },
              parity_shards: { type: ['integer', 'null'] },
              redundancy_ratio: { type: ['number', 'null'] },
              host_count: { type: 'integer' },
              country_count: { type: 'integer' },
            },
          },
          hosts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                public_key: { type: 'string' },
                sectors: { type: 'integer' },
                country_code: { type: ['string', 'null'] },
                latitude: { type: ['number', 'null'] },
                longitude: { type: ['number', 'null'] },
                good_for_upload: { type: ['boolean', 'null'] },
              },
            },
          },
          countries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                country_code: { type: 'string' },
                hosts: { type: 'integer' },
                sectors: { type: 'integer' },
              },
            },
          },
          contracts: {
            type: ['array', 'null'],
            items: { type: 'string' },
            description: 'Active file contracts on these hosts; null without an indexd admin API.',
          },
          indexer: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              network: { type: 'string' },
              wallet_address: { type: ['string', 'null'] },
            },
          },
        },
      },
      Rendition: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          width: { type: ['integer', 'null'] },
          height: { type: ['integer', 'null'] },
          video_bitrate_kbps: { type: ['integer', 'null'] },
          segment_count: { type: 'integer' },
          byte_size: { type: 'integer' },
          data_object_id: { type: 'string' },
          playlist_object_id: { type: 'string' },
        },
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
      get: {
        tags: ['Auth'],
        summary: 'Begin GitHub OAuth login.',
        security: [],
        responses: { '302': { description: 'Redirect to GitHub.' } },
      },
    },
    '/api/v1/auth/github/callback': {
      get: {
        tags: ['Auth'],
        summary: 'GitHub OAuth callback.',
        security: [],
        responses: { '302': { description: 'Redirect into the Studio.' } },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current session identity.',
        security: [{ cookieAuth: [] }],
        responses: { '200': { description: 'Session info.' }, '401': errorResponse },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'End the current session and clear its cookie.',
        security: [{ cookieAuth: [] }],
        responses: { '200': { description: 'Logged out.' } },
      },
    },
    '/api/v1/auth/sessions': {
      get: {
        tags: ['Auth'],
        summary: "The signed-in user's live Studio sessions, newest first.",
        description:
          'Studio sessions only: an API key cannot list sessions. Each entry has id, user_agent, created_at, expires_at and current (true for the session making the request).',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': { description: 'The sessions.' },
          '401': errorResponse,
          '409': { ...errorResponse, description: 'Sign-in is disabled on this server.' },
        },
      },
      delete: {
        tags: ['Auth'],
        summary: 'Sign out everywhere: end every session of the signed-in user.',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': { description: 'Sessions ended; `revoked` is how many.' },
          '401': errorResponse,
          '409': { ...errorResponse, description: 'Sign-in is disabled on this server.' },
        },
      },
    },
    '/api/v1/auth/sessions/{id}': {
      delete: {
        tags: ['Auth'],
        summary: 'End one session of the signed-in user.',
        security: [{ cookieAuth: [] }],
        parameters: [idParam('id', 'Session id, from GET /api/v1/auth/sessions.')],
        responses: {
          '200': { description: 'Session ended.' },
          '401': errorResponse,
          '404': errorResponse,
          '409': { ...errorResponse, description: 'Sign-in is disabled on this server.' },
        },
      },
    },

    // ── Uploads ──
    // Uploads are created through the TUS protocol at POST /api/v1/uploads,
    // which the TUS server handles directly (not a REST JSON route). The REST
    // surface documented here is status polling and cancellation.
    '/api/v1/uploads': {
      post: {
        tags: ['Uploads'],
        summary: 'Start a resumable upload (tus 1.0.0 creation).',
        description:
          'Creates the video asset and returns its tus upload url in Location. Send the bytes with ' +
          'PATCH to that url; a HEAD on it returns Upload-Metadata with videoAssetId. Metadata keys: ' +
          'filename, filetype, title, description, accessTier (values base64).',
        'x-required-scope': 'upload',
        'x-handled-by': 'tus',
        parameters: [
          { name: 'Tus-Resumable', in: 'header', required: true, schema: { const: '1.0.0' } },
          { name: 'Upload-Length', in: 'header', required: true, schema: { type: 'integer' } },
          { name: 'Upload-Metadata', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '201': { description: 'Created; the upload url is in Location.' },
          '401': errorResponse,
          '413': { description: 'Larger than MAX_UPLOAD_SIZE.' },
          '415': { description: 'Not a video file type.' },
        },
      },
    },
    '/api/v1/uploads/{id}': {
      patch: {
        tags: ['Uploads'],
        summary: 'Send upload bytes (tus).',
        'x-required-scope': 'upload',
        'x-handled-by': 'tus',
        parameters: [
          idParam('id', 'tus upload id, the last segment of Location.'),
          { name: 'Tus-Resumable', in: 'header', required: true, schema: { const: '1.0.0' } },
          { name: 'Upload-Offset', in: 'header', required: true, schema: { type: 'integer' } },
        ],
        requestBody: { content: { 'application/offset+octet-stream': {} } },
        responses: { '204': { description: 'Accepted; Upload-Offset is the new offset.' } },
      },
      head: {
        tags: ['Uploads'],
        summary: 'Upload offset and metadata (tus).',
        'x-required-scope': 'upload',
        'x-handled-by': 'tus',
        parameters: [
          idParam('id', 'tus upload id.'),
          { name: 'Tus-Resumable', in: 'header', required: true, schema: { const: '1.0.0' } },
        ],
        responses: { '200': { description: 'Upload-Offset and Upload-Metadata headers.' } },
      },
      get: {
        tags: ['Uploads'],
        summary: 'Upload session status.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Upload session id.')],
        responses: { '200': { description: 'Session status.' }, '404': errorResponse },
      },
      delete: {
        tags: ['Uploads'],
        summary: 'Cancel an upload session.',
        'x-required-scope': 'upload',
        parameters: [idParam('id', 'Upload session id.')],
        responses: { '200': { description: 'Cancelled.' } },
      },
    },

    // ── Assets ──
    '/api/v1/assets': {
      get: {
        tags: ['Assets'],
        summary: 'List assets with search, filters, sorting and pagination.',
        'x-required-scope': 'read',
        parameters: [
          { $ref: '#/components/parameters/limit' },
          { $ref: '#/components/parameters/cursor' },
          { $ref: '#/components/parameters/page' },
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['created', 'uploading', 'processing', 'ready', 'failed'],
            },
            description: 'Filter by status.',
          },
          {
            name: 'access_tier',
            in: 'query',
            schema: { type: 'string', enum: ['public', 'private'] },
          },
          {
            name: 'search',
            in: 'query',
            schema: { type: 'string', maxLength: 200 },
            description: 'Case-insensitive match on title or description, or an exact asset id.',
          },
          {
            name: 'sort',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['created_at', 'title', 'duration', 'size'],
              default: 'created_at',
            },
          },
          {
            name: 'order',
            in: 'query',
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            description:
              'Cursor paging is only available for created_at desc; other orders use page.',
          },
        ],
        responses: {
          '200': jsonResponse('AssetList', 'A page of assets.'),
          '400': errorResponse,
          '403': errorResponse,
        },
      },
    },
    '/api/v1/assets/{id}': {
      get: {
        tags: ['Assets'],
        summary: 'Get an asset.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset id.')],
        responses: { '200': jsonResponse('Asset', 'The asset.'), '404': errorResponse },
      },
      patch: {
        tags: ['Assets'],
        summary: 'Update asset metadata.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Asset id.')],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  access_tier: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': jsonResponse('Asset', 'Updated.'), '404': errorResponse },
      },
      delete: {
        tags: ['Assets'],
        summary: 'Delete an asset.',
        description:
          'Soft-deletes the asset so it disappears from the API immediately, then ' +
          'asynchronously unpins its Sia objects and removes the record.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Asset id.')],
        responses: { '200': { description: 'Deletion accepted; unpin runs in the background.' } },
      },
    },
    '/api/v1/assets/{id}/processing': {
      get: {
        tags: ['Assets'],
        summary: 'Processing status for an asset.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset id.')],
        responses: {
          '200': jsonResponse('ProcessingStatus', 'Processing status.'),
          '404': errorResponse,
        },
      },
    },
    '/api/v1/assets/{id}/renditions': {
      get: {
        tags: ['Assets'],
        summary: 'HLS renditions of an asset, tallest first.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset id.')],
        responses: {
          '200': {
            description: 'Renditions.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Rendition' } },
                  },
                },
              },
            },
          },
          '404': errorResponse,
        },
      },
    },
    '/api/v1/assets/{id}/retry': {
      post: {
        tags: ['Assets'],
        summary: 'Retry a failed asset.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Asset id.')],
        responses: { '200': { description: 'Retry enqueued.' }, '400': errorResponse },
      },
    },
    '/api/v1/assets/{id}/sia': {
      get: {
        tags: ['Storage'],
        summary: 'Per-asset Sia storage breakdown.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset id.')],
        responses: {
          '200': jsonResponse('SiaStorageInfo', 'Storage breakdown.'),
          '404': errorResponse,
        },
      },
    },
    '/api/v1/assets/{id}/playback-ids': {
      post: {
        tags: ['Playback'],
        summary: 'Create a playback ID.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Asset id.')],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  policy: { type: 'string', enum: ['public', 'signed'] },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': jsonResponse('PlaybackId', 'Created.'),
          '400': errorResponse,
          '404': errorResponse,
        },
      },
      get: {
        tags: ['Playback'],
        summary: 'List playback IDs for an asset.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset id.')],
        responses: { '200': jsonResponse('PlaybackIdList', 'Playback IDs.') },
      },
    },
    '/api/v1/playback-ids/{playbackId}': {
      delete: {
        tags: ['Playback'],
        summary: 'Delete a playback ID.',
        'x-required-scope': 'manage',
        parameters: [idParam('playbackId', 'Public pb_ handle.')],
        responses: { '200': { description: 'Deleted.' }, '404': errorResponse },
      },
    },

    // ── Playback ──
    '/api/v1/playback/{id}': {
      get: {
        tags: ['Playback'],
        summary: 'Playback info + URL for an asset or playback ID.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset UUID or pb_ playback ID.')],
        responses: {
          '200': jsonResponse('PlaybackInfo', 'Playback info.'),
          '404': errorResponse,
          '409': errorResponse,
        },
      },
    },
    '/api/v1/playback/{id}/signed': {
      get: {
        tags: ['Playback'],
        summary: 'Time-limited signed playback URL.',
        'x-required-scope': 'read',
        parameters: [
          idParam('id', 'Asset UUID or pb_ playback ID.'),
          { name: 'expires_in', in: 'query', schema: { type: 'integer', default: 3600 } },
        ],
        responses: {
          '200': jsonResponse('SignedUrl', 'Signed URL.'),
          '404': errorResponse,
          '409': errorResponse,
        },
      },
    },
    '/api/v1/playback/{id}/share': {
      get: {
        tags: ['Playback'],
        summary: 'Per-object sia:// share URLs for direct-from-Sia playback.',
        'x-required-scope': 'read',
        parameters: [
          idParam('id', 'Asset UUID or pb_ playback ID.'),
          { name: 'expires_in', in: 'query', schema: { type: 'integer', default: 3600 } },
        ],
        responses: {
          '200': jsonResponse('SharePlaybackInfo', 'Share URL map.'),
          '404': errorResponse,
          '409': errorResponse,
          '502': errorResponse,
        },
      },
    },

    // ── Keys ──
    '/api/v1/keys': {
      post: {
        tags: ['Keys'],
        summary: 'Create an API key.',
        'x-required-scope': 'manage',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  scopes: {
                    type: 'array',
                    items: { type: 'string', enum: ['upload', 'read', 'manage'] },
                  },
                  rate_limit: { type: 'integer' },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          '201': jsonResponse('ApiKey', 'Created (raw key shown once).'),
          '400': errorResponse,
        },
      },
      get: {
        tags: ['Keys'],
        summary: 'List API keys.',
        'x-required-scope': 'manage',
        responses: { '200': { description: 'Keys.' } },
      },
    },
    '/api/v1/keys/{id}/rotate': {
      post: {
        tags: ['Keys'],
        summary: 'Rotate an API key.',
        description:
          'Issues a new secret with the same name, scopes and rate limit. The old key stops ' +
          'working now, or after grace_period_seconds (up to 604800) for a zero-downtime switch.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Key id.')],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  grace_period_seconds: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 604800,
                    default: 0,
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'The replacement key, with its secret shown once.' },
          '400': errorResponse,
          '404': errorResponse,
          '409': {
            ...errorResponse,
            description: 'The key was already rotated; rotate its replacement instead.',
          },
        },
      },
    },
    '/api/v1/keys/{id}': {
      delete: {
        tags: ['Keys'],
        summary: 'Delete an API key.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Key id.')],
        responses: { '200': { description: 'Deleted.' } },
      },
    },

    // ── Webhooks ──
    '/api/v1/webhooks': {
      post: {
        tags: ['Webhooks'],
        summary: 'Register a webhook endpoint for your account.',
        description:
          'Events are delivered only for assets owned by the same account, signed with ' +
          'an HMAC-SHA256 of the raw body in X-Sluby-Signature. The secret is returned once.',
        'x-required-scope': 'manage',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string', format: 'uri', description: 'Absolute http(s) URL.' },
                  events: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'string',
                      enum: [
                        'upload.started',
                        'upload.completed',
                        'upload.failed',
                        'processing.started',
                        'asset.ready',
                        'asset.errored',
                      ],
                    },
                  },
                },
                required: ['url', 'events'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created; includes the signing secret once.' },
          '400': errorResponse,
        },
      },
      get: {
        tags: ['Webhooks'],
        summary: 'List webhook endpoints.',
        'x-required-scope': 'read',
        responses: { '200': { description: 'Endpoints.' } },
      },
    },
    '/api/v1/webhooks/{id}': {
      delete: {
        tags: ['Webhooks'],
        summary: 'Delete a webhook endpoint.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Endpoint id.')],
        responses: { '200': { description: 'Deleted.' } },
      },
    },

    // ── Reconciliation ──
    '/api/v1/reconciliation': {
      get: {
        tags: ['Reconciliation'],
        summary: 'Latest reconciliation run.',
        description:
          'Every caller sees the deployment-wide counts. Object ids are scoped: a tenant ' +
          'gets the missing ids of its own assets, and only the platform identity gets the ' +
          'full lists, orphaned ids included.',
        'x-required-scope': 'manage',
        responses: {
          '200': jsonResponse('ReconciliationRun', 'Latest run.'),
          '404': errorResponse,
        },
      },
    },
    '/api/v1/reconciliation/run': {
      post: {
        tags: ['Reconciliation'],
        summary: 'Trigger a reconciliation run.',
        description:
          'Queues a run unless one, manual or scheduled, is already waiting or running, so ' +
          'repeated calls never stack runs.',
        'x-required-scope': 'manage',
        responses: {
          '202': jsonResponse('ReconciliationTrigger', 'Queued, or a run was already pending.'),
        },
      },
    },

    // ── Ops ──
    '/api/v1/stats': {
      get: {
        tags: ['Ops'],
        summary: "Library totals for the caller's tenant.",
        'x-required-scope': 'read',
        responses: { '200': jsonResponse('AssetStats', 'Totals.') },
      },
    },
    '/api/v1/system/status': {
      get: {
        tags: ['Ops'],
        summary: 'Live platform status: database, redis, Sia indexer, reconciliation, cache.',
        'x-required-scope': 'read',
        responses: { '200': jsonResponse('SystemStatus', 'Status report.') },
      },
    },
    '/api/v1/metrics': {
      get: {
        tags: ['Ops'],
        summary: 'Platform metrics (prometheus registry as JSON).',
        'x-required-scope': 'read',
        responses: { '200': { description: 'Metrics.' } },
      },
    },

    // ── Delivery gateway ──
    '/v1/objects/{objectId}': {
      get: {
        tags: ['Delivery'],
        summary: 'Stream a Sia object, with byte-range support.',
        security: [],
        parameters: [
          idParam('objectId', 'Sia object ID.'),
          {
            name: 'type',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['manifest', 'playlist', 'thumbnail', 'video', 'segment', 'data'],
            },
            description: 'Content-type hint.',
          },
          {
            name: 'Range',
            in: 'header',
            schema: { type: 'string' },
            description: 'Byte range, e.g. `bytes=0-1023`.',
          },
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
      get: {
        tags: ['Delivery'],
        summary: 'Master HLS manifest for an asset or playback ID.',
        security: [],
        parameters: [idParam('videoAssetId', 'Asset UUID or pb_ playback ID.')],
        responses: {
          '200': { description: 'HLS manifest.', content: { 'application/vnd.apple.mpegurl': {} } },
          '404': errorResponse,
        },
      },
    },
    '/v1/share/{id}': {
      get: {
        tags: ['Delivery'],
        summary: 'Per-object sia:// share URLs for direct-from-Sia playback, without credentials.',
        description:
          'Gated like /v1/stream: a public asset with a public playback ID needs nothing. A ' +
          'private asset, a signed-policy playback ID, or a public asset that has a signed ' +
          'playback ID needs the `expires` and `sig` of its signed master URL, and the shares ' +
          'then never outlive `expires`. Expiries are capped like the authenticated route (six ' +
          'hours, one hour when gated) and rounded to five-minute slots that the server caches, ' +
          'so repeated calls do not mint again. A gated map is sent `private, no-store`; a ' +
          'public one may be cached for up to a minute.',
        security: [],
        parameters: [
          idParam('id', 'Asset UUID or pb_ playback ID.'),
          {
            name: 'expires',
            in: 'query',
            schema: { type: 'integer' },
            description: 'Expiry (unix seconds) from the signed master URL. Required when gated.',
          },
          {
            name: 'sig',
            in: 'query',
            schema: { type: 'string' },
            description: 'Signature from the signed master URL. Required when gated.',
          },
          { name: 'expires_in', in: 'query', schema: { type: 'integer', default: 3600 } },
        ],
        responses: {
          '200': jsonResponse('SharePlaybackInfo', 'Share URL map.'),
          '403': errorResponse,
          '404': errorResponse,
          '502': errorResponse,
        },
      },
    },
    '/v1/cache/stats': {
      get: {
        tags: ['Ops'],
        summary: 'Delivery cache statistics.',
        security: [],
        responses: { '200': jsonResponse('CacheStats', 'Cache stats.') },
      },
    },
  },
} as const;

export type OpenApiDocument = typeof openapiDocument;
