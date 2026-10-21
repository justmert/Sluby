/**
 * OpenAPI 3.1 description of the Sluby REST API and delivery gateway.
 *
 * Served at `GET /api/v1/openapi.json` and rendered at `GET /api/v1/docs`.
 * Two tests hold it to the code: `openapi-drift.test.ts` compares the paths,
 * methods, scopes and operations-only marks with the mounted routes, and
 * `api-contract.pg.test.ts` sends real requests to every operation and
 * checks each status code is listed here and each JSON body matches its
 * schema.
 *
 * `x-required-scope` on an operation records the API-key scope its
 * middleware enforces (`upload` | `read` | `manage`); `x-required-identity:
 * admin` marks operations only an admin may use. Auth endpoints and the public
 * spec/docs carry `security: []`.
 */

const bearerAuth = [{ bearerAuth: [] as string[] }];

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
};

const errorWith = (description: string) => ({ ...errorResponse, description });

const ref = (name: string) => ({ $ref: `#/components/responses/${name}` });

const jsonResponse = (schemaRef: string, description: string) => ({
  description,
  content: {
    'application/json': { schema: { $ref: `#/components/schemas/${schemaRef}` } },
  },
});

const jsonSchemaResponse = (schema: Record<string, unknown>, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const textResponse = (description: string) => ({
  description,
  content: { 'text/plain': { schema: { type: 'string' } } },
});

/** 401, 403 and 429, which every key-checked operation can answer. */
const authFailures = {
  '401': ref('Unauthorized'),
  '403': ref('Forbidden'),
  '429': ref('TooManyRequests'),
};

/** A malformed id in the path is a 400, like any other bad input. */
const badId = errorWith('Invalid input, such as a malformed id.');

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({
  type: [type, 'null'],
  ...extra,
});

const assetEtagHeader = {
  ETag: {
    description:
      'The asset’s version: its `updated_at` in milliseconds since the epoch, quoted. Send it ' +
      'back in If-Match on PATCH. Plays do not change it, so it never validates a cached copy: ' +
      'GET answers with `Cache-Control: no-store` and ignores If-None-Match.',
    schema: { type: 'string', example: '"1767225600000"' },
  },
};

const idParam = (name: string, description: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' },
  description,
});

/** Admins manage members from the Studio or with their own key. */
const memberSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }];

/** The token of an invite or reset link, from its Studio url. */
const linkTokenParam = idParam('token', 'The token from the invite or reset link.');

/** The session cookie a sign-in sets. */
const sessionCookieHeader = {
  'Set-Cookie': {
    description: 'The `sluby_session` cookie of the new session (HttpOnly, SameSite=Lax).',
    schema: { type: 'string' },
  },
};

/** 429 from the attempt limits of the sign-in routes. */
const attemptsLimited = {
  description: 'Too many attempts; try again after `retry_after` seconds.',
  headers: { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
  content: { 'application/json': { schema: { $ref: '#/components/schemas/RateLimited' } } },
};

export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Sluby API',
    version: '1.0.0',
    description:
      'REST API and delivery gateway for Sluby, decentralized video streaming on ' +
      'the Sia network. Programmatic access uses a scoped API key sent as a ' +
      '`Bearer` token; the Studio UI uses a session cookie.\n\n' +
      'One server is one team’s workspace: every asset, key, webhook and upload belongs ' +
      'to the workspace, and every member and key works with all of them. Members are ' +
      '`admin` or `member`; a key acts with the current role of the member who made it ' +
      'and stops while that member is removed, and a key made from the server ' +
      '(`BOOTSTRAP_API_KEY`, `npm run db:seed-key`) has no creator and acts as an admin. ' +
      'Deployment-wide operations data (full system status, metrics, the whole ' +
      'reconciliation run) is for admins only.\n\n' +
      'Errors are JSON `{ "error": "...", "details": [...] }`; `details` lists the ' +
      'invalid fields of a 400. Every response of a key-checked operation carries ' +
      '`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; over the ' +
      'limit the answer is 429 with `Retry-After`. A path no route serves answers 404 ' +
      'whether or not a key is sent.',
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
    { name: 'Auth', description: 'Studio sign-in, setup, invite and reset links.' },
    { name: 'Members', description: 'Members, roles and invites (admins only).' },
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
        description:
          'Signed session cookie issued to the Studio at sign-in (email and password, GitHub, ' +
          'setup, or an invite or reset link).',
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
          'page to fetch the next one. A cursor that does not decode is a 400.',
      },
      page: {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
        description: 'Offset page number (alternative to `cursor`; sending both is a 400).',
      },
    },
    headers: {
      RetryAfter: {
        description: 'Seconds until the rate-limit window resets.',
        schema: { type: 'integer' },
      },
      RateLimitLimit: {
        description: 'Requests allowed per one-minute window for this key or session.',
        schema: { type: 'integer' },
      },
      RateLimitRemaining: {
        description: 'Requests left in the current window.',
        schema: { type: 'integer' },
      },
      RateLimitReset: {
        description: 'Seconds until the current window resets.',
        schema: { type: 'integer' },
      },
    },
    responses: {
      BadRequest: errorWith('Invalid input; `details` lists the fields.'),
      Unauthorized: errorWith(
        'No valid API key or session. Without a key, `reason` says why the session ended.',
      ),
      Forbidden: errorWith('The key lacks the scope (or the admin role) the operation needs.'),
      NotFound: errorWith('No such resource in the workspace.'),
      TooManyRequests: {
        description:
          'Over the rate limit of the key or session, or of the client address for a call without valid credentials.',
        headers: {
          'Retry-After': { $ref: '#/components/headers/RetryAfter' },
          'X-RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
          'X-RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
          'X-RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
        },
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/RateLimited' } },
        },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'What went wrong, for people.' },
          details: {
            type: 'array',
            description: 'The invalid fields of a 400, when the body or query failed validation.',
            items: {
              type: 'object',
              required: ['field', 'message'],
              properties: {
                field: { type: 'string', description: 'Dotted path; empty for the whole input.' },
                message: { type: 'string' },
              },
            },
          },
          message: {
            type: 'string',
            description: 'Only with EXPOSE_ERROR_STACKS=true: the internal error message.',
          },
          stack: {
            type: 'string',
            description: 'Only with EXPOSE_ERROR_STACKS=true: the stack trace.',
          },
          reason: {
            type: 'string',
            enum: [
              'missing',
              'expired',
              'revoked',
              'not_allowed',
              'bad_credentials',
              'disabled',
              'bad_code',
              'already_set_up',
              'email_taken',
              'no_password',
              'used',
              'last_admin',
              'self',
            ],
            description:
              'On a 401 to a request without an API key (a browser session): `missing` (no ' +
              'session cookie, or one this server did not sign), `expired`, `revoked` (signed ' +
              'out, here or from another browser) or `not_allowed` (an admin removed the ' +
              'account). A key whose creator was removed also answers `not_allowed`. The ' +
              'sign-in routes add their own: `bad_credentials` (wrong email or password), ' +
              '`disabled` (the account was removed), `bad_code` (wrong setup code), ' +
              '`already_set_up`, `email_taken`, `no_password`, and on a 410 for a link ' +
              '`used`, `expired` or `revoked`. The members routes answer 409 with ' +
              '`last_admin` (it would leave no admin who can sign in) or `self` (nobody ' +
              'removes themselves).',
          },
        },
        required: ['error'],
      },
      RateLimited: {
        type: 'object',
        required: ['error', 'retry_after'],
        properties: {
          error: { type: 'string' },
          retry_after: { type: 'integer', description: 'Seconds, as in Retry-After.' },
          retryAfter: {
            type: 'integer',
            deprecated: true,
            description:
              'Older spelling of retry_after, kept so clients written for 0.1.0 keep working.',
          },
        },
      },
      Success: {
        type: 'object',
        required: ['success'],
        properties: { success: { const: true } },
      },
      Asset: {
        type: 'object',
        required: [
          'id',
          'title',
          'description',
          'manifest_object_id',
          'thumbnail_object_ids',
          'duration_ms',
          'resolution',
          'status',
          'access_tier',
          'creator_address',
          'segment_count',
          'total_storage_bytes',
          'play_count',
          'last_played_at',
          'created_at',
          'updated_at',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          manifest_object_id: { type: ['string', 'null'] },
          thumbnail_object_ids: { type: 'array', items: { type: 'string' } },
          duration_ms: nullable('integer', {
            description: 'Null until processing has measured it.',
          }),
          resolution: nullable('string', {
            description: 'Source resolution, e.g. `1920x1080`; null until processing has read it.',
          }),
          status: {
            type: 'string',
            enum: ['created', 'uploading', 'processing', 'ready', 'failed'],
          },
          access_tier: { type: 'string', enum: ['public', 'private'] },
          creator_address: { type: 'string' },
          segment_count: { type: 'integer' },
          total_storage_bytes: { type: 'integer' },
          play_count: {
            type: 'integer',
            minimum: 0,
            description:
              'All-time plays: player loads this server saw, through the gateway or by minting ' +
              'a share map to play direct from Sia. One viewer loading the same video again ' +
              'within 30 minutes counts once, previews in the Studio do not count, and counts ' +
              'reach the API within about 10 seconds.',
          },
          last_played_at: nullable('string', {
            format: 'date-time',
            description: 'When the newest counted play happened; null before the first.',
          }),
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      AssetList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Asset' } },
          total: { type: 'integer', description: 'Every match of the filters, on all pages.' },
          page: nullable('integer', { description: 'Null on a page fetched with a cursor.' }),
          limit: { type: 'integer' },
          next_cursor: { type: ['string', 'null'] },
          has_more: { type: 'boolean' },
        },
        required: ['data', 'total', 'page', 'limit', 'next_cursor', 'has_more'],
      },
      AssetDeleted: {
        type: 'object',
        required: ['success', 'status'],
        properties: {
          success: { const: true },
          status: {
            const: 'deleting',
            description:
              'The asset is gone from the API; its Sia objects are unpinned in the background.',
          },
        },
      },
      RetryStarted: {
        type: 'object',
        required: ['success', 'stage'],
        properties: {
          success: { const: true },
          stage: {
            type: 'string',
            enum: ['upload-segments', 'transcode'],
            description:
              '`upload-segments` when a finished transcode is still on disk, else `transcode`.',
          },
        },
      },
      ProcessingStatus: {
        type: 'object',
        required: [
          'id',
          'status',
          'stage',
          'progress_percent',
          'retry_count',
          'error_message',
          'started_at',
          'completed_at',
          'created_at',
          'logs',
          'retryable',
        ],
        properties: {
          id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['queued', 'processing', 'completed', 'failed', 'retrying'],
          },
          stage: {
            type: 'string',
            enum: ['queued', 'transcode', 'upload', 'finalize', 'completed', 'failed'],
            description:
              'Pipeline step, from the latest stage-tagged log line. `upload` starts as soon as ' +
              'the transcode hands off, with the line "Waiting for the Sia uploader" while the ' +
              'video waits its turn to be stored on Sia.',
          },
          progress_percent: { type: 'integer' },
          retry_count: {
            type: 'integer',
            description:
              'Retries of the pipeline stages so far: each automatic retry and each manual retry.',
          },
          error_message: { type: ['string', 'null'] },
          started_at: { type: ['string', 'null'], format: 'date-time' },
          completed_at: { type: ['string', 'null'], format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
          retryable: {
            type: 'boolean',
            description:
              'Whether POST /retry can start a new run: true only for a failed video whose ' +
              'failure was not final (a file that is not a readable video is final) and whose ' +
              'finished transcode or original file is still on the server.',
          },
          logs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                timestamp: { type: 'string', format: 'date-time' },
                stage: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      PlaybackInfo: {
        type: 'object',
        required: ['playback_url', 'poster_url', 'duration_ms', 'resolution', 'access_tier'],
        properties: {
          playback_url: {
            type: 'string',
            description:
              'Path of the master manifest on this deployment, e.g. `/v1/objects/<id>?type=manifest`. ' +
              'A path, so a client can resolve it against its own delivery base (a CDN in front ' +
              'of the gateway, say). It is unsigned: a private asset needs /signed or /share.',
          },
          poster_url: nullable('string', { description: 'Path of the first thumbnail.' }),
          duration_ms: nullable('integer'),
          resolution: nullable('string'),
          access_tier: { type: 'string', enum: ['public', 'private'] },
        },
      },
      SignedUrl: {
        type: 'object',
        required: ['signed_url', 'poster_url', 'expires_at'],
        properties: {
          signed_url: {
            type: 'string',
            format: 'uri',
            description:
              'Absolute url of the master manifest on PUBLIC_URL with `expires` and `sig` ' +
              'appended; the gateway signs the child urls in it on the fly.',
          },
          poster_url: nullable('string', {
            format: 'uri',
            description:
              'Absolute url of the first thumbnail, signed the same way and valid as long, so a ' +
              'player can show a poster for a private asset. Null when the asset has none.',
          }),
          expires_at: { type: 'string', format: 'date-time' },
        },
      },
      SignedUrlsRevoked: {
        type: 'object',
        required: ['success', 'signing_generation'],
        properties: {
          success: { const: true },
          signing_generation: {
            type: 'integer',
            description: 'The asset signing generation now in force; every older url is void.',
          },
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
        required: ['id', 'playback_id', 'policy', 'name', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          playback_id: { type: 'string', description: 'Public `pb_...` handle.' },
          policy: { type: 'string', enum: ['public', 'signed'] },
          name: { type: ['string', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      PlaybackIdList: {
        type: 'object',
        required: ['data'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/PlaybackId' } },
        },
      },
      ReconciliationRun: {
        description:
          'The latest run. Its shape depends on `scope`: admins (`deployment`) get the whole ' +
          'run; members (`account`) get only the drift of the workspace’s assets, because the ' +
          'deployment-wide counts, orphans and failure text describe the server’s setup. Objects the indexer ' +
          'pinned or unpinned within the hour before the run are work in progress and in ' +
          'neither list, so the in-sync count plus the orphan or missing count can be lower ' +
          'than the indexer or database count.',
        oneOf: [
          { $ref: '#/components/schemas/ReconciliationRunDeployment' },
          { $ref: '#/components/schemas/ReconciliationRunAccount' },
        ],
        discriminator: { propertyName: 'scope' },
      },
      ReconciliationRunDeployment: {
        type: 'object',
        required: [
          'scope',
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
          'missing_ids',
          'missing_objects',
          'orphaned_ids',
        ],
        properties: {
          scope: { const: 'deployment' },
          id: { type: 'string', format: 'uuid' },
          started_at: { type: 'string', format: 'date-time' },
          finished_at: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['ok', 'drift', 'failed'] },
          db_object_count: { type: 'integer' },
          indexer_object_count: { type: 'integer' },
          in_sync_count: { type: 'integer' },
          orphan_count: { type: 'integer' },
          missing_count: { type: 'integer' },
          error_message: { type: ['string', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
          missing_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tracked by an asset, absent from the indexer.',
          },
          missing_objects: {
            type: 'array',
            description:
              'Each of `missing_ids`, in the same order, with the video that holds it, so a ' +
              'report can link to it. `video_asset_id` and `title` are null when no live video ' +
              'holds the object any more (its video was deleted since the run).',
            items: { $ref: '#/components/schemas/MissingObject' },
          },
          orphaned_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Pinned on the indexer, tracked by no asset.',
          },
        },
      },
      ReconciliationRunAccount: {
        type: 'object',
        required: [
          'scope',
          'id',
          'started_at',
          'finished_at',
          'created_at',
          'status',
          'missing_count',
          'missing_ids',
          'missing_objects',
        ],
        properties: {
          scope: { const: 'account' },
          id: { type: 'string', format: 'uuid' },
          started_at: { type: 'string', format: 'date-time' },
          finished_at: { type: 'string', format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
          status: {
            type: 'string',
            enum: ['ok', 'drift', 'failed'],
            description:
              '`drift` when objects of the workspace’s assets are missing, `failed` when the ' +
              'run itself could not complete.',
          },
          missing_count: {
            type: 'integer',
            description: 'Missing objects of the workspace’s assets.',
          },
          missing_ids: { type: 'array', items: { type: 'string' } },
          missing_objects: {
            type: 'array',
            description:
              'Each of `missing_ids`, in the same order, with the video that holds it, so a ' +
              'report can link to it. `video_asset_id` and `title` are null when no live video ' +
              'holds the object any more (its video was deleted since the run).',
            items: { $ref: '#/components/schemas/MissingObject' },
          },
        },
      },
      MissingObject: {
        type: 'object',
        required: ['object_id', 'video_asset_id', 'title'],
        properties: {
          object_id: { type: 'string' },
          video_asset_id: nullable('string', { format: 'uuid' }),
          title: nullable('string'),
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
        required: ['total', 'by_status', 'stored_bytes', 'ready_duration_ms', 'object_count'],
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
      HealthProbe: {
        type: 'object',
        required: ['ok', 'latency_ms'],
        properties: {
          ok: { type: 'boolean' },
          latency_ms: { type: 'integer' },
        },
      },
      Probe: {
        type: 'object',
        required: ['ok', 'latency_ms'],
        properties: {
          ok: { type: 'boolean' },
          latency_ms: { type: 'integer' },
          error: { type: 'string', description: 'Why the probe failed, when it did.' },
        },
      },
      HostPool: {
        type: ['object', 'null'],
        properties: {
          total: { type: 'integer' },
          good_for_upload: { type: 'integer' },
          countries: { type: 'integer' },
        },
      },
      SystemStatus: {
        description:
          'Live status. Its shape depends on `scope`: admins (`deployment`) get the full ' +
          'report; members (`account`) get a health summary without ' +
          'the indexer account, the indexer url, probe error text, process uptime, the ' +
          'delivery cache or the deployment-wide reconciliation result.',
        oneOf: [
          { $ref: '#/components/schemas/SystemStatusDeployment' },
          { $ref: '#/components/schemas/SystemStatusAccount' },
        ],
        discriminator: { propertyName: 'scope' },
      },
      SystemStatusAccount: {
        type: 'object',
        additionalProperties: false,
        required: ['scope', 'status', 'checked_at', 'version', 'database', 'redis', 'indexer'],
        properties: {
          scope: { const: 'account' },
          status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
          checked_at: { type: 'string', format: 'date-time' },
          version: { type: 'string' },
          database: { $ref: '#/components/schemas/HealthProbe' },
          redis: { $ref: '#/components/schemas/HealthProbe' },
          indexer: {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'latency_ms', 'network', 'hosts'],
            properties: {
              ok: { type: 'boolean' },
              latency_ms: { type: 'integer' },
              network: { type: 'string' },
              hosts: { $ref: '#/components/schemas/HostPool' },
            },
          },
        },
      },
      SystemStatusDeployment: {
        type: 'object',
        required: [
          'scope',
          'status',
          'checked_at',
          'version',
          'uptime_seconds',
          'database',
          'redis',
          'indexer',
          'reconciliation',
          'cache',
        ],
        properties: {
          scope: { const: 'deployment' },
          status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
          checked_at: { type: 'string', format: 'date-time' },
          version: { type: 'string' },
          uptime_seconds: { type: 'integer' },
          database: { $ref: '#/components/schemas/Probe' },
          redis: { $ref: '#/components/schemas/Probe' },
          indexer: {
            type: 'object',
            required: ['ok', 'latency_ms', 'url', 'network', 'account', 'hosts'],
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
              hosts: { $ref: '#/components/schemas/HostPool' },
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
      Metrics: {
        type: 'object',
        required: ['timestamp', 'metrics'],
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          metrics: {
            type: 'array',
            description: 'The metrics registry as JSON, one entry per metric.',
            items: {
              type: 'object',
              required: ['name', 'type', 'values'],
              properties: {
                name: { type: 'string' },
                help: { type: 'string' },
                type: { type: 'string' },
                values: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
      },
      UploadStatus: {
        type: 'object',
        required: [
          'id',
          'video_asset_id',
          'status',
          'progress_percent',
          'file_size',
          'uploaded_bytes',
        ],
        properties: {
          id: {
            type: 'string',
            description: 'The upload id: the last segment of the tus Location.',
          },
          video_asset_id: nullable('string', { format: 'uuid' }),
          status: { type: 'string', enum: ['uploading', 'completed', 'cancelled', 'failed'] },
          progress_percent: { type: 'integer', minimum: 0, maximum: 100 },
          file_size: { type: 'integer' },
          uploaded_bytes: { type: 'integer' },
        },
      },
      ApiKey: {
        type: 'object',
        required: [
          'id',
          'name',
          'scopes',
          'rate_limit',
          'is_active',
          'created_at',
          'expires_at',
          'prefix',
          'last_used_at',
          'created_by',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string', enum: ['upload', 'read', 'manage'] } },
          rate_limit: { type: 'integer', description: 'Requests per minute.' },
          is_active: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          expires_at: {
            type: ['string', 'null'],
            format: 'date-time',
            description: 'Set while a rotated-out key is in its grace period.',
          },
          prefix: nullable('string', {
            description:
              'The first 12 characters of the key (`sluby_` and 6 more), to tell keys apart. ' +
              'Null for keys created before prefixes were stored.',
          }),
          last_used_at: nullable('string', {
            format: 'date-time',
            description:
              'When the key last authenticated a request, to the minute: it is written at most ' +
              'once a minute per key. Null if never used since this was recorded.',
          }),
          created_by: {
            type: ['object', 'null'],
            description:
              'The member who made the key; it acts with their current role and stops while ' +
              'they are removed. Null for a key made from the server (`BOOTSTRAP_API_KEY`, ' +
              '`npm run db:seed-key`), made by such a key, or whose maker was deleted: it acts ' +
              'as an admin.',
            required: ['id', 'name'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string', description: 'Display name.' },
            },
          },
        },
      },
      ApiKeyList: {
        type: 'object',
        required: ['data', 'has_more', 'next_cursor', 'limits'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } },
          has_more: { type: 'boolean' },
          next_cursor: { type: ['string', 'null'] },
          limits: {
            type: 'object',
            description: 'This server’s limits on keys, to check a new key against.',
            required: ['max_keys', 'max_rate_limit'],
            properties: {
              max_keys: {
                type: 'integer',
                description:
                  'How many usable keys the workspace may hold (`API_KEYS_PER_ACCOUNT_MAX`).',
              },
              max_rate_limit: {
                type: 'integer',
                description: 'The highest `rate_limit` a key may have (`API_KEY_RATE_LIMIT_MAX`).',
              },
            },
          },
        },
      },
      ApiKeyCreated: {
        description: 'A key as listed, plus its secret, which is only ever shown here.',
        allOf: [
          { $ref: '#/components/schemas/ApiKey' },
          {
            type: 'object',
            required: ['key'],
            properties: { key: { type: 'string', description: 'The raw `sluby_...` key.' } },
          },
        ],
      },
      ApiKeyRotated: {
        allOf: [
          { $ref: '#/components/schemas/ApiKeyCreated' },
          {
            type: 'object',
            required: ['rotated_from', 'previous_key_expires_at'],
            properties: {
              rotated_from: { type: 'string', format: 'uuid' },
              previous_key_expires_at: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
      Webhook: {
        type: 'object',
        required: [
          'id',
          'url',
          'events',
          'is_active',
          'created_at',
          'last_delivery_at',
          'last_delivery_ok',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          url: { type: 'string' },
          events: { type: 'array', items: { type: 'string' } },
          is_active: {
            type: 'boolean',
            description: 'False while the endpoint is paused: no events are sent to it.',
          },
          created_at: { type: 'string', format: 'date-time' },
          last_delivery_at: nullable('string', {
            format: 'date-time',
            description: 'When the newest delivery attempt was made; null before the first.',
          }),
          last_delivery_ok: nullable('boolean', {
            description:
              'Whether the newest attempt got a 2xx answer; null before the first. Attempts are ' +
              'kept for 30 days.',
          }),
        },
      },
      WebhookList: {
        type: 'object',
        required: ['data'],
        properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } } },
      },
      WebhookCreated: {
        type: 'object',
        required: ['id', 'url', 'events', 'secret'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          url: { type: 'string' },
          events: { type: 'array', items: { type: 'string' } },
          secret: { type: 'string', description: 'The signing secret, only ever shown here.' },
        },
      },
      AuthMe: {
        type: 'object',
        required: [
          'id',
          'name',
          'username',
          'provider',
          'provider_label',
          'auth_disabled',
          'role',
          'operator',
          'sign_in',
          'expires_at',
        ],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'The account id.' },
          name: { type: 'string', description: 'Display name.' },
          username: {
            type: 'string',
            description:
              "The handle the session signed in with: the email for `password`, GitHub's login " +
              'for `github`.',
          },
          provider: nullable('string', {
            description:
              'How this session signed in: `password`, `github`, or `local` with AUTH_DISABLED.',
          }),
          provider_label: nullable('string'),
          auth_disabled: {
            type: 'boolean',
            description:
              'True when the server runs with AUTH_DISABLED and this is the local dev account.',
          },
          role: {
            type: 'string',
            enum: ['admin', 'member'],
            description:
              'Admins also see deployment-wide operations data (the full system status, ' +
              'metrics and the whole reconciliation report) and manage members. Always ' +
              '`admin` for the local dev account, the one user of an AUTH_DISABLED server.',
          },
          operator: {
            type: 'boolean',
            deprecated: true,
            description: 'Use `role`. True when `role` is `admin`.',
          },
          sign_in: {
            type: 'array',
            description: 'Every way the account signs in.',
            items: { $ref: '#/components/schemas/SignInMethod' },
          },
          expires_at: nullable('string', { format: 'date-time' }),
          providerLabel: {
            type: ['string', 'null'],
            deprecated: true,
            description:
              'Older spelling of provider_label, kept so clients written for 0.1.0 keep working.',
          },
          authDisabled: {
            type: 'boolean',
            deprecated: true,
            description:
              'Older spelling of auth_disabled, kept so clients written for 0.1.0 keep working.',
          },
          expiresAt: {
            type: 'integer',
            deprecated: true,
            description:
              'Older unix-seconds form of expires_at, kept so clients written for 0.1.0 keep working.',
          },
        },
      },
      StudioSessionList: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'user_agent', 'created_at', 'expires_at', 'last_seen_at', 'current'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                user_agent: { type: ['string', 'null'] },
                created_at: { type: 'string', format: 'date-time' },
                expires_at: { type: 'string', format: 'date-time' },
                last_seen_at: nullable('string', {
                  format: 'date-time',
                  description:
                    'The last request made with the session, to within five minutes. Null until ' +
                    'its first request on a server that records it.',
                }),
                current: { type: 'boolean', description: 'The session making the request.' },
              },
            },
          },
        },
      },
      SessionsRevoked: {
        type: 'object',
        required: ['success', 'revoked'],
        properties: { success: { const: true }, revoked: { type: 'integer' } },
      },
      Member: {
        type: 'object',
        required: ['id', 'name', 'role', 'status', 'sign_in', 'created_at', 'last_sign_in_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'member'] },
          status: {
            type: 'string',
            enum: ['active', 'removed'],
            description:
              '`removed`: an admin removed the member, who cannot sign in and whose keys stop ' +
              'until they are restored.',
          },
          sign_in: { type: 'array', items: { $ref: '#/components/schemas/SignInMethod' } },
          created_at: { type: 'string', format: 'date-time' },
          last_sign_in_at: nullable('string', {
            format: 'date-time',
            description: 'The latest sign-in by any method, null when the member has none.',
          }),
        },
      },
      MemberList: {
        type: 'object',
        required: ['data'],
        properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Member' } } },
      },
      RoleRequest: {
        type: 'object',
        required: ['role'],
        additionalProperties: false,
        properties: { role: { type: 'string', enum: ['admin', 'member'] } },
      },
      ResetLink: {
        type: 'object',
        required: ['url', 'expires_at'],
        properties: {
          url: {
            type: 'string',
            description:
              '`<PUBLIC_URL>/studio/reset/<token>`. Single use; only shown here, so pass it on ' +
              'to the member now.',
          },
          expires_at: { type: 'string', format: 'date-time' },
        },
      },
      Invite: {
        type: 'object',
        required: ['id', 'role', 'created_at', 'expires_at', 'max_uses', 'uses', 'created_by'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          role: { type: 'string', enum: ['admin', 'member'] },
          created_at: { type: 'string', format: 'date-time' },
          expires_at: { type: 'string', format: 'date-time' },
          max_uses: {
            type: ['integer', 'null'],
            minimum: 1,
            maximum: 1000,
            description:
              'How many people may join with it; null lets anyone join until it expires or is revoked.',
          },
          uses: { type: 'integer', minimum: 0, description: 'How many people joined with it.' },
          created_by: {
            type: ['object', 'null'],
            required: ['id', 'name'],
            properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
            description: 'The admin who made it, null for a key with no creator.',
          },
        },
      },
      InviteList: {
        type: 'object',
        required: ['data'],
        properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Invite' } } },
      },
      InviteCreated: {
        type: 'object',
        required: ['id', 'url', 'role', 'max_uses', 'uses', 'expires_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          url: {
            type: 'string',
            description: '`<PUBLIC_URL>/studio/join/<token>`. Only shown here, so pass it on now.',
          },
          role: { type: 'string', enum: ['admin', 'member'] },
          max_uses: {
            type: ['integer', 'null'],
            minimum: 1,
            maximum: 1000,
            description:
              'How many people may join with it; null lets anyone join until it expires or is revoked.',
          },
          uses: { type: 'integer', minimum: 0, description: 'How many people joined with it.' },
          expires_at: { type: 'string', format: 'date-time' },
        },
      },
      InviteRequest: {
        type: 'object',
        required: ['role'],
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['admin', 'member'] },
          max_uses: {
            type: ['integer', 'null'],
            minimum: 1,
            maximum: 1000,
            default: 1,
            description:
              'How many people may join with the link; null lets anyone join until it expires or ' +
              'is revoked. Anything but 1 needs `role: member`.',
          },
          expires_in_days: {
            type: 'integer',
            enum: [1, 7, 30],
            default: 7,
            description: 'How many days the link works.',
          },
        },
      },
      SignInMethod: {
        type: 'object',
        required: ['provider', 'username'],
        properties: {
          provider: {
            type: 'string',
            description: '`password`, `github`, or `local` (the AUTH_DISABLED account).',
          },
          username: {
            type: 'string',
            description: 'The email for `password`, the login for `github`.',
          },
        },
      },
      AuthConfig: {
        type: 'object',
        required: ['auth_disabled', 'setup_required', 'methods'],
        properties: {
          auth_disabled: {
            type: 'boolean',
            description: 'Sign-in is off (AUTH_DISABLED): every request is the local admin.',
          },
          setup_required: {
            type: 'boolean',
            description:
              'No admin who can sign in exists yet, so the Studio shows the setup screen. ' +
              'The setup code is in the server log.',
          },
          methods: {
            type: 'object',
            required: ['password', 'github'],
            properties: {
              password: { const: true },
              github: { type: 'boolean', description: 'A GitHub OAuth app is configured.' },
            },
          },
        },
      },
      SetupRequest: {
        type: 'object',
        required: ['code', 'name', 'email', 'password'],
        additionalProperties: false,
        properties: {
          code: {
            type: 'string',
            description:
              'The setup code from the server log, `XXXXX-XXXXX`; case and dashes do not matter.',
          },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', maxLength: 254, description: 'Stored trimmed and lowercased.' },
          password: { type: 'string', minLength: 10, maxLength: 256 },
        },
      },
      PasswordSignInRequest: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', description: 'Compared trimmed and lowercased.' },
          password: { type: 'string', minLength: 1, maxLength: 1024 },
        },
      },
      RenameRequest: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100, description: 'Trimmed.' },
        },
      },
      EmailChangeRequest: {
        type: 'object',
        required: ['email', 'current_password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', maxLength: 254, description: 'Trimmed and lowercased.' },
          current_password: { type: 'string', minLength: 1, maxLength: 1024 },
        },
      },
      PasswordChangeRequest: {
        type: 'object',
        required: ['current_password', 'new_password'],
        additionalProperties: false,
        properties: {
          current_password: { type: 'string', minLength: 1, maxLength: 1024 },
          new_password: { type: 'string', minLength: 10, maxLength: 256 },
        },
      },
      LinkInfo: {
        type: 'object',
        required: ['kind', 'expires_at', 'github'],
        properties: {
          kind: { type: 'string', enum: ['invite', 'reset'] },
          role: {
            type: 'string',
            enum: ['admin', 'member'],
            description: 'Invites only: the role the new member gets.',
          },
          email: nullable('string', {
            description:
              'Reset links only: the email the member signs in with, null when they have no ' +
              'password yet (then accepting needs `email`).',
          }),
          expires_at: { type: 'string', format: 'date-time' },
          github: {
            type: 'boolean',
            description: 'GitHub sign-in is configured, so an invite can be accepted with it.',
          },
        },
      },
      LinkAcceptRequest: {
        description:
          'For an invite: `name`, `email` and `password`, making a new member. For a reset ' +
          'link: `password`, plus `email` when the member has no password yet.',
        oneOf: [
          {
            type: 'object',
            title: 'Invite',
            required: ['name', 'email', 'password'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 100 },
              email: { type: 'string', maxLength: 254 },
              password: { type: 'string', minLength: 10, maxLength: 256 },
            },
          },
          {
            type: 'object',
            title: 'Reset',
            required: ['password'],
            additionalProperties: false,
            properties: {
              password: { type: 'string', minLength: 10, maxLength: 256 },
              email: { type: 'string', maxLength: 254 },
            },
          },
        ],
      },
      Health: {
        type: 'object',
        required: ['status', 'timestamp', 'version'],
        properties: {
          status: { const: 'ok' },
          timestamp: { type: 'string', format: 'date-time' },
          version: { type: 'string' },
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
    '/health': {
      get: {
        tags: ['Ops'],
        summary: 'Liveness probe.',
        description:
          'Answers while the process is up; dependency health is GET /api/v1/system/status, so ' +
          'a flaky indexer never restarts the container.',
        security: [],
        responses: { '200': jsonResponse('Health', 'The process is up.') },
      },
    },
    '/metrics': {
      get: {
        tags: ['Ops'],
        summary: 'Prometheus metrics, in the text exposition format.',
        description:
          'Guarded by the METRICS_TOKEN setting rather than an API key. With METRICS_TOKEN set, ' +
          'every request needs `Authorization: Bearer <METRICS_TOKEN>`, straight to the backend ' +
          'port or through the shipped nginx. Without it, the endpoint answers only requests ' +
          'made straight to the backend port; a request that came through a proxy (one that ' +
          'carries X-Forwarded-For or Forwarded, which nginx always sets) gets the same 404 as ' +
          'an unknown route.',
        security: [],
        responses: {
          '200': {
            description: 'The registry in Prometheus text format.',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
          '401': errorWith(
            'METRICS_TOKEN is set and the request did not send it as a bearer token.',
          ),
          '404': errorWith('METRICS_TOKEN is not set and the request came through a proxy.'),
          '500': errorWith('The registry could not be read.'),
        },
      },
    },
    '/api/v1/openapi.json': {
      get: {
        tags: ['Ops'],
        summary: 'This OpenAPI document.',
        security: [],
        responses: {
          '200': jsonSchemaResponse({ type: 'object' }, 'The OpenAPI 3.1 document.'),
        },
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

    '/api/v1/auth/{provider}/login': {
      get: {
        tags: ['Auth'],
        summary: 'Begin a Studio sign-in with a provider.',
        description:
          'Sets the short-lived `sluby_signin` cookie (path /api/v1/auth) holding the handshake ' +
          'state and where to land afterwards, then redirects to the provider. `next` is a path ' +
          'on this server; anything that would leave the origin falls back to /studio.',
        security: [],
        parameters: [
          {
            name: 'provider',
            in: 'path' as const,
            required: true,
            schema: { type: 'string', enum: ['github'] },
            description: 'The sign-in provider.',
          },
          {
            name: 'next',
            in: 'query' as const,
            required: false,
            schema: { type: 'string' },
            description: 'Studio path to land on after sign-in, /studio by default.',
          },
          {
            name: 'invite',
            in: 'query' as const,
            required: false,
            schema: { type: 'string' },
            description:
              'An invite token: join as a new member with this provider account instead of ' +
              'signing in. The token stays in the handshake cookie and is never sent to the ' +
              'provider.',
          },
          {
            name: 'link',
            in: 'query' as const,
            required: false,
            schema: { type: 'string', enum: ['1'] },
            description:
              'Add this provider account to the signed-in account (needs the session cookie).',
          },
        ],
        responses: {
          '302': {
            description:
              'Redirect to the provider, or back to `next` with `signin_error`: ' +
              '`not_configured` when the provider is not configured on this server, ' +
              '`invite_not_found` for a malformed invite token, `not_signed_in` for `link=1` ' +
              'without a session.',
          },
          '404': errorWith('No such sign-in provider.'),
        },
      },
    },
    '/api/v1/auth/{provider}/callback': {
      get: {
        tags: ['Auth'],
        summary: "The provider's redirect back after sign-in.",
        description:
          'Browser-facing: every outcome is a redirect into the Studio. Accepted only from the ' +
          'browser that started the sign-in: the `state` must match the `sluby_signin` cookie set ' +
          "by the login route, within ten minutes. The account is the provider's stable id " +
          '(GitHub: the numeric account id), never the login. A failure redirects to the ' +
          'page the sign-in started from (or `/studio` once the handshake is lost) with ' +
          '`signin_error=<code>` added: `expired_handshake` (expired, or started in another ' +
          'browser), `not_a_member` (with `&handle=<login>`, nobody added this account; people ' +
          'join through invites), `disabled` (with `&handle`, an admin removed the member), ' +
          '`already_linked` (with `&handle`, joining or linking with an account another member ' +
          'already signs in with), `not_signed_in` (a link finished without the session it ' +
          'began in), `invite_not_found`, `invite_used`, `invite_expired`, `invite_revoked` ' +
          '(with `&handle`, joining with an invite that does not work), `cancelled` (the ' +
          'person declined at the provider), `provider_failed` (the provider refused the code ' +
          'or could not be reached) or `not_configured`. A join signs the new member in; a ' +
          'link keeps the current session.',
        security: [],
        parameters: [
          {
            name: 'provider',
            in: 'path' as const,
            required: true,
            schema: { type: 'string', enum: ['github'] },
            description: 'The sign-in provider.',
          },
        ],
        responses: {
          '302': {
            description:
              'Signed in (redirect to `next` with a session cookie), or failed (redirect to ' +
              '`next`, or `/studio`, with `signin_error=<code>`).',
          },
          '404': errorWith('No such sign-in provider.'),
        },
      },
    },
    '/api/v1/auth/config': {
      get: {
        tags: ['Auth'],
        summary: 'How this server signs people in.',
        description:
          'Public: the Studio reads it before anyone is signed in, to show the setup screen or ' +
          'the sign-in methods.',
        security: [],
        responses: { '200': jsonResponse('AuthConfig', 'The sign-in configuration.') },
      },
    },
    '/api/v1/auth/setup': {
      post: {
        tags: ['Auth'],
        summary: 'Set up the first admin with the setup code, and sign in.',
        description:
          'Works while `setup_required` is true: no admin who can sign in exists. The code is ' +
          'printed in the server log at startup. 10 attempts per client address in 10 minutes.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SetupRequest' } },
          },
        },
        responses: {
          '201': {
            ...jsonResponse('Success', 'The admin exists and is signed in.'),
            headers: sessionCookieHeader,
          },
          '400': ref('BadRequest'),
          '403': errorWith('Wrong setup code (`reason: bad_code`).'),
          '409': errorWith(
            'An admin already exists (`already_set_up`), the email is taken (`email_taken`), ' +
              'or sign-in is disabled on this server.',
          ),
          '429': attemptsLimited,
        },
      },
    },
    '/api/v1/auth/password': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with an email and password.',
        description:
          '10 attempts per client address in 10 minutes, and 5 wrong passwords per email in ' +
          '15 minutes.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PasswordSignInRequest' } },
          },
        },
        responses: {
          '200': {
            ...jsonResponse('Success', 'Signed in.'),
            headers: sessionCookieHeader,
          },
          '400': ref('BadRequest'),
          '401': errorWith('Wrong email or password (`reason: bad_credentials`).'),
          '403': errorWith('The password is right but the account was removed (`disabled`).'),
          '409': errorWith('Sign-in is disabled on this server.'),
          '429': attemptsLimited,
        },
      },
    },
    '/api/v1/auth/password/change': {
      post: {
        tags: ['Auth'],
        summary: "Change the signed-in member's password.",
        description:
          'Studio sessions only. Every other session of the account ends; this one stays. ' +
          '`revoked` is how many ended.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PasswordChangeRequest' } },
          },
        },
        responses: {
          '200': jsonResponse('SessionsRevoked', 'Changed.'),
          '400': ref('BadRequest'),
          '401': ref('Unauthorized'),
          '403': errorWith('The current password is wrong (`reason: bad_credentials`).'),
          '409': errorWith(
            'The account has no password (`no_password`), or sign-in is disabled on this server.',
          ),
          '429': attemptsLimited,
        },
      },
    },
    '/api/v1/auth/invites/{token}': {
      get: {
        tags: ['Auth'],
        summary: 'What an invite or reset link is for.',
        description:
          'Public: the join and reset pages call it with the token from their url. 30 link ' +
          'requests per client address in 10 minutes.',
        security: [],
        parameters: [linkTokenParam],
        responses: {
          '200': jsonResponse('LinkInfo', 'The link works.'),
          '403': errorWith('A reset link of a removed member (`disabled`).'),
          '404': errorWith('No such link.'),
          '409': errorWith('Sign-in is disabled on this server.'),
          '410': errorWith('The link was `used`, has `expired` or was `revoked` (in `reason`).'),
          '429': attemptsLimited,
        },
      },
    },
    '/api/v1/auth/invites/{token}/accept': {
      post: {
        tags: ['Auth'],
        summary: 'Use an invite or reset link, and sign in.',
        description:
          'An invite makes a new member with its role. A reset link sets the member’s password ' +
          '(their first, when they had none) and ends every other session of the account. ' +
          'Either way the link is used up and the browser is signed in.',
        security: [],
        parameters: [linkTokenParam],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LinkAcceptRequest' } },
          },
        },
        responses: {
          '200': {
            ...jsonResponse('Success', 'Password set from a reset link, signed in.'),
            headers: sessionCookieHeader,
          },
          '201': {
            ...jsonResponse('Success', 'Joined with an invite, signed in.'),
            headers: sessionCookieHeader,
          },
          '400': ref('BadRequest'),
          '403': errorWith('A reset link of a removed member (`disabled`).'),
          '404': errorWith('No such link.'),
          '409': errorWith(
            'Another account signs in with this email (`email_taken`), or sign-in is disabled ' +
              'on this server.',
          ),
          '410': errorWith('The link was `used`, has `expired` or was `revoked` (in `reason`).'),
          '429': attemptsLimited,
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'The signed-in account.',
        description:
          'The account id and display name, plus the provider, provider label and handle the ' +
          'browser signed in with, its role, every way it signs in (`sign_in`), and the ' +
          'session expiry. ' +
          'With AUTH_DISABLED it is the local dev account (`provider: "local"`, ' +
          '`auth_disabled: true`, `role: "admin"`).',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': jsonResponse('AuthMe', 'The signed-in account, or the local dev account.'),
          '401': ref('Unauthorized'),
        },
      },
      patch: {
        tags: ['Auth'],
        summary: "Change the signed-in member's name.",
        description: 'Studio sessions only. The name the members list and the Studio show.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RenameRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Renamed.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          '400': ref('BadRequest'),
          '401': ref('Unauthorized'),
          '409': errorWith('Sign-in is disabled on this server.'),
        },
      },
    },
    '/api/v1/auth/email/change': {
      post: {
        tags: ['Auth'],
        summary: 'Change the email the signed-in member signs in with.',
        description:
          'Studio sessions only. Needs the current password; the password itself stays. ' +
          'Counts against the same attempt limits as a password change.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/EmailChangeRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Changed.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: { email: { type: 'string' } },
                },
              },
            },
          },
          '400': ref('BadRequest'),
          '401': ref('Unauthorized'),
          '403': errorWith('The current password is wrong (`reason: bad_credentials`).'),
          '409': errorWith(
            'Another account signs in with that email (`email_taken`), the account has no ' +
              'password (`no_password`), or sign-in is disabled on this server.',
          ),
          '429': attemptsLimited,
        },
      },
    },
    '/api/v1/auth/identities/{provider}': {
      delete: {
        tags: ['Auth'],
        summary: 'Stop signing in with a provider.',
        description:
          'Studio sessions only. Takes a provider such as GitHub off the signed-in account. ' +
          'Sessions that signed in through it end. An email and password is changed, not removed.',
        security: [{ cookieAuth: [] }],
        parameters: [
          {
            name: 'provider',
            in: 'path' as const,
            required: true,
            schema: { type: 'string', enum: ['github'] },
            description: 'The sign-in provider.',
          },
        ],
        responses: {
          '200': jsonResponse('Success', 'Removed.'),
          '401': ref('Unauthorized'),
          '404': errorWith('No such provider, or the account does not sign in with it.'),
          '409': errorWith(
            'This browser signed in with it (`current_sign_in`), it is the only way to sign in ' +
              '(`last_sign_in`), or sign-in is disabled on this server.',
          ),
        },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'End the current session and clear its cookie.',
        security: [{ cookieAuth: [] }],
        responses: { '200': jsonResponse('Success', 'Logged out.') },
      },
    },
    '/api/v1/auth/sessions': {
      get: {
        tags: ['Auth'],
        summary: "The signed-in user's live Studio sessions, newest first.",
        description: 'Studio sessions only: an API key cannot list sessions.',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': jsonResponse('StudioSessionList', 'The sessions.'),
          '401': ref('Unauthorized'),
          '409': errorWith('Sign-in is disabled on this server.'),
        },
      },
      delete: {
        tags: ['Auth'],
        summary: 'Sign out everywhere: end every session of the signed-in account.',
        description: 'API keys are not touched; revoke them from the keys routes.',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': jsonResponse('SessionsRevoked', 'Sessions ended; `revoked` is how many.'),
          '401': ref('Unauthorized'),
          '409': errorWith('Sign-in is disabled on this server.'),
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
          '200': jsonResponse('Success', 'Session ended.'),
          '400': badId,
          '401': ref('Unauthorized'),
          '404': ref('NotFound'),
          '409': errorWith('Sign-in is disabled on this server.'),
        },
      },
    },

    // Uploads are created and fed through the tus protocol, which the tus
    // server answers before the express routers (`x-handled-by: tus`). GET
    // and DELETE on an upload are REST, DELETE with Tus-Resumable is tus.
    '/api/v1/uploads': {
      post: {
        tags: ['Uploads'],
        summary: 'Start a resumable upload (tus 1.0.0 creation).',
        description:
          'Creates the video asset and answers with the upload url in Location: ' +
          '`<PUBLIC_URL>/api/v1/uploads/<upload id>`. The upload id (a uuid) is also the id of ' +
          'GET and DELETE /api/v1/uploads/{id}. Send the bytes with PATCH to that url; a HEAD ' +
          'on it returns Upload-Metadata with videoAssetId. Metadata keys (values base64): ' +
          'filename, filetype (must be video/* when given), title (up to 200 characters, ' +
          '"Untitled" when missing), description (up to 5000 characters), accessTier or ' +
          'access_tier (public or private, default public). Errors answer plain text.',
        'x-required-scope': 'upload',
        'x-handled-by': 'tus',
        parameters: [
          { name: 'Tus-Resumable', in: 'header', required: true, schema: { const: '1.0.0' } },
          {
            name: 'Upload-Length',
            in: 'header',
            required: true,
            schema: { type: 'integer', minimum: 1 },
            description: 'Size in bytes; at most MAX_UPLOAD_SIZE (10 GB by default).',
          },
          { name: 'Upload-Metadata', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '201': {
            description: 'Created; the upload url is in Location.',
            headers: { Location: { schema: { type: 'string', format: 'uri' } } },
          },
          '400': textResponse('Invalid metadata (tier, title, description) or an empty file.'),
          '401': textResponse('No valid API key or session.'),
          '403': textResponse('The key lacks the upload scope.'),
          '413': textResponse('Larger than MAX_UPLOAD_SIZE.'),
          '415': textResponse('Not a video file type.'),
          '500': textResponse('The upload could not be created; nothing was kept.'),
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
          idParam('id', 'Upload id, the last segment of Location.'),
          { name: 'Tus-Resumable', in: 'header', required: true, schema: { const: '1.0.0' } },
          { name: 'Upload-Offset', in: 'header', required: true, schema: { type: 'integer' } },
        ],
        requestBody: { content: { 'application/offset+octet-stream': {} } },
        responses: {
          '204': { description: 'Accepted; Upload-Offset is the new offset.' },
          '400': textResponse('Invalid tus headers.'),
          '401': textResponse('No valid API key or session.'),
          '403': textResponse('The key lacks the upload scope.'),
          '404': textResponse('No such upload in the workspace.'),
          '409': textResponse('Upload-Offset does not match the bytes received so far.'),
          '410': textResponse('The upload expired.'),
          '413': textResponse('More bytes than the declared Upload-Length.'),
        },
      },
      head: {
        tags: ['Uploads'],
        summary: 'Upload offset and metadata (tus).',
        'x-required-scope': 'upload',
        'x-handled-by': 'tus',
        parameters: [
          idParam('id', 'Upload id.'),
          { name: 'Tus-Resumable', in: 'header', required: true, schema: { const: '1.0.0' } },
        ],
        responses: {
          '200': { description: 'Upload-Offset and Upload-Metadata headers.' },
          '401': { description: 'No valid API key or session.' },
          '403': { description: 'The key lacks the upload scope.' },
          '404': { description: 'No such upload in the workspace.' },
          '410': { description: 'The upload expired.' },
        },
      },
      get: {
        tags: ['Uploads'],
        summary: 'Upload status.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Upload id, the last segment of the tus Location.')],
        responses: {
          '200': jsonResponse('UploadStatus', 'Status and progress.'),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
      delete: {
        tags: ['Uploads'],
        summary: 'Cancel an upload in progress.',
        description:
          'Without Tus-Resumable this is the REST cancel: the partial file and the asset the ' +
          'upload created are removed, and the session is marked cancelled (200). With ' +
          'Tus-Resumable it is a tus termination, which does the same and answers 204. A ' +
          'finished upload is the source its asset is processed and retried from and cannot ' +
          'be cancelled: REST answers 409, tus 400; delete the asset instead (manage scope).',
        'x-required-scope': 'upload',
        parameters: [idParam('id', 'Upload id, the last segment of the tus Location.')],
        responses: {
          '200': jsonResponse('Success', 'Cancelled (REST).'),
          '204': { description: 'Terminated (tus).' },
          '400': errorWith(
            'A malformed id (REST), or a tus termination of a finished upload (plain text).',
          ),
          '404': ref('NotFound'),
          '409': errorWith('The upload is no longer in progress (REST).'),
          ...authFailures,
        },
      },
    },

    '/api/v1/assets': {
      get: {
        tags: ['Assets'],
        summary: 'List assets with search, filters, sorting and pagination.',
        description:
          'Each parameter may be given once; a repeated or malformed one is a 400. Unknown ' +
          'parameters are ignored.',
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
          '400': ref('BadRequest'),
          ...authFailures,
        },
      },
    },
    '/api/v1/assets/{id}': {
      get: {
        tags: ['Assets'],
        summary: 'Get an asset.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset id.')],
        responses: {
          '200': { ...jsonResponse('Asset', 'The asset.'), headers: assetEtagHeader },
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
      patch: {
        tags: ['Assets'],
        summary: 'Update asset metadata.',
        description:
          'Changing access_tier takes effect on the delivery gateway at once. An asset being ' +
          'deleted answers 404, as it does to every read. Send If-Match with the ETag of the ' +
          'version you edited (from GET or an earlier PATCH, or built from `updated_at` as ' +
          '`"<epoch milliseconds>"`) and the edit applies only if nobody changed the asset since; ' +
          'otherwise 412 with the asset as it is now. Processing changes the version too.',
        'x-required-scope': 'manage',
        parameters: [
          idParam('id', 'Asset id.'),
          {
            name: 'If-Match',
            in: 'header' as const,
            required: false,
            schema: { type: 'string' },
            description:
              'One or more ETags, or `*` for any version. The weak form of an ETag (`W/"…"`, as a ' +
              'compressing proxy such as the bundled nginx sends it) matches the same version.',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  title: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                    description: 'Trimmed; no control characters.',
                  },
                  description: {
                    type: 'string',
                    maxLength: 5000,
                    description: 'No control characters other than tabs and line breaks.',
                  },
                  access_tier: { type: 'string', enum: ['public', 'private'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { ...jsonResponse('Asset', 'Updated.'), headers: assetEtagHeader },
          '400': errorWith('Invalid input, or an If-Match that is not an ETag.'),
          '404': ref('NotFound'),
          '412': {
            description: 'The asset changed since the If-Match version; nothing was saved.',
            headers: assetEtagHeader,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error', 'current'],
                  properties: {
                    error: { type: 'string' },
                    current: { $ref: '#/components/schemas/Asset' },
                  },
                },
              },
            },
          },
          ...authFailures,
        },
      },
      delete: {
        tags: ['Assets'],
        summary: 'Delete an asset.',
        description:
          'Soft-deletes the asset so it disappears from the API immediately, then ' +
          'asynchronously unpins its Sia objects and removes the record. A second DELETE ' +
          'answers 404.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Asset id.')],
        responses: {
          '200': jsonResponse('AssetDeleted', 'Deletion accepted; unpin runs in the background.'),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
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
          '400': badId,
          '404': errorWith('No such asset, or it has no processing job yet.'),
          ...authFailures,
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
          '200': jsonSchemaResponse(
            {
              type: 'object',
              required: ['data'],
              properties: {
                data: { type: 'array', items: { $ref: '#/components/schemas/Rendition' } },
              },
            },
            'Renditions.',
          ),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
    },
    '/api/v1/assets/{id}/retry': {
      post: {
        tags: ['Assets'],
        summary: 'Retry a failed asset.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Asset id.')],
        responses: {
          '200': jsonResponse('RetryStarted', 'Retry enqueued.'),
          '400': errorWith('A malformed id, or the asset is not in the failed state.'),
          '404': ref('NotFound'),
          '410': errorWith('The source file is gone; upload the video again.'),
          ...authFailures,
        },
      },
    },
    '/api/v1/assets/{id}/sia': {
      get: {
        tags: ['Storage'],
        summary: 'Per-asset Sia storage breakdown.',
        description:
          'Objects the indexer cannot describe right now are listed in unavailable_object_ids ' +
          'rather than failing the request.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset id.')],
        responses: {
          '200': jsonResponse('SiaStorageInfo', 'Storage breakdown.'),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
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
                  policy: { type: 'string', enum: ['public', 'signed'], default: 'public' },
                  name: {
                    type: 'string',
                    maxLength: 100,
                    description:
                      'A label to tell playback IDs apart. Trimmed; no control characters.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': jsonResponse('PlaybackId', 'Created.'),
          '400': errorWith('A malformed id, an unknown policy or a name over 100 characters.'),
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
      get: {
        tags: ['Playback'],
        summary: 'List playback IDs for an asset.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset id.')],
        responses: {
          '200': jsonResponse('PlaybackIdList', 'Playback IDs.'),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
    },
    '/api/v1/playback-ids/{playbackId}': {
      delete: {
        tags: ['Playback'],
        summary: 'Delete a playback ID.',
        'x-required-scope': 'manage',
        parameters: [idParam('playbackId', 'Public pb_ handle.')],
        responses: {
          '200': jsonResponse('Success', 'Deleted.'),
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
    },

    '/api/v1/playback/{id}': {
      get: {
        tags: ['Playback'],
        summary: 'Playback info + URL for an asset or playback ID.',
        'x-required-scope': 'read',
        parameters: [idParam('id', 'Asset UUID or pb_ playback ID.')],
        responses: {
          '200': jsonResponse('PlaybackInfo', 'Playback info.'),
          '400': badId,
          '404': ref('NotFound'),
          '409': errorWith('The asset is not ready for playback.'),
          ...authFailures,
        },
      },
    },
    '/api/v1/playback/{id}/signed': {
      get: {
        tags: ['Playback'],
        summary: 'Time-limited signed playback URL.',
        description:
          'Signs the master manifest (and the first thumbnail as a poster) for the asset. The ' +
          'signature covers the asset signing generation, so every url minted so far stops ' +
          'working when the asset tier changes or POST /api/v1/playback/{id}/signed/revoke is ' +
          'called. A url never lasts longer than six hours.',
        'x-required-scope': 'read',
        parameters: [
          idParam('id', 'Asset UUID or pb_ playback ID.'),
          {
            name: 'expires_in',
            in: 'query',
            schema: { type: 'integer', default: 3600, minimum: 60, maximum: 21600 },
            description:
              'Lifetime of the url in seconds. A whole number outside 60 to 21600 is brought ' +
              'to the nearest bound (the answer `expires_at` says what was minted); anything ' +
              'else is a 400.',
          },
        ],
        responses: {
          '200': jsonResponse('SignedUrl', 'Signed URL.'),
          '400': errorWith('A malformed id, or an expires_in that is not a whole number.'),
          '404': ref('NotFound'),
          '409': errorWith('The asset is not ready for playback.'),
          ...authFailures,
        },
      },
    },
    '/api/v1/playback/{id}/signed/revoke': {
      post: {
        tags: ['Playback'],
        summary: 'Revoke every signed URL of an asset.',
        description:
          'Raises the asset signing generation, so every signed url minted for it so far (and ' +
          'every child url signed from one) is refused from now on; new ones can be minted ' +
          'straight away. A pb_ id revokes for its whole asset. Copies of public objects a ' +
          'shared cache already holds are unaffected, and sia:// share maps run until their ' +
          'own expiry.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Asset UUID or pb_ playback ID.')],
        responses: {
          '200': jsonResponse('SignedUrlsRevoked', 'Revoked.'),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
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
          {
            name: 'renew',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Set (any value) when replacing a map the player already holds during one ' +
              'watch, so it is not counted as another play. The SDK sets it.',
          },
        ],
        responses: {
          '200': jsonResponse('SharePlaybackInfo', 'Share URL map.'),
          '400': badId,
          '404': ref('NotFound'),
          '409': errorWith('The asset is not ready for playback.'),
          '502': errorWith('The Sia indexer did not answer while minting.'),
          '503': errorWith('The database did not answer while minting.'),
          ...authFailures,
        },
      },
    },

    '/api/v1/members': {
      get: {
        tags: ['Members'],
        summary: 'Every member of the workspace, removed ones included.',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        security: memberSecurity,
        responses: { '200': jsonResponse('MemberList', 'The members.'), ...authFailures },
      },
    },
    '/api/v1/members/{id}': {
      patch: {
        tags: ['Members'],
        summary: "Change a member's role.",
        description:
          'Applies to their sessions and keys on their next request. The last admin who can ' +
          'sign in stays an admin (409 `last_admin`).',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        security: memberSecurity,
        parameters: [idParam('id', 'Member id.')],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RoleRequest' } } },
        },
        responses: {
          '200': jsonResponse('Member', 'The member with the new role.'),
          '400': ref('BadRequest'),
          ...authFailures,
          '404': ref('NotFound'),
          '409': errorWith('It would leave no admin who can sign in (`last_admin`).'),
        },
      },
    },
    '/api/v1/members/{id}/remove': {
      post: {
        tags: ['Members'],
        summary: 'Remove a member.',
        description:
          'They cannot sign in, every session they have ends and their keys stop, until they ' +
          'are restored. Nobody removes themselves (409 `self`), and the last admin who can ' +
          'sign in stays (409 `last_admin`).',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        security: memberSecurity,
        parameters: [idParam('id', 'Member id.')],
        responses: {
          '200': jsonResponse('Member', 'The removed member.'),
          '400': badId,
          ...authFailures,
          '404': ref('NotFound'),
          '409': errorWith('`self` or `last_admin`.'),
        },
      },
    },
    '/api/v1/members/{id}/restore': {
      post: {
        tags: ['Members'],
        summary: 'Let a removed member back in.',
        description: 'They keep the role they had, and their keys work again.',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        security: memberSecurity,
        parameters: [idParam('id', 'Member id.')],
        responses: {
          '200': jsonResponse('Member', 'The restored member.'),
          '400': badId,
          ...authFailures,
          '404': ref('NotFound'),
        },
      },
    },
    '/api/v1/members/{id}/reset-link': {
      post: {
        tags: ['Members'],
        summary: 'A link where the member sets a new password.',
        description:
          'Single use, valid for 7 days. For a member who signs in with GitHub only it sets ' +
          'their first password, with an email they choose. Using it ends their other sessions.',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        security: memberSecurity,
        parameters: [idParam('id', 'Member id.')],
        responses: {
          '201': jsonResponse('ResetLink', 'The link, shown only here.'),
          '400': badId,
          ...authFailures,
          '404': ref('NotFound'),
        },
      },
    },
    '/api/v1/invites': {
      get: {
        tags: ['Members'],
        summary: 'Pending invites, newest first.',
        description:
          'Invites that still let someone join, with how many people joined with each. Their ' +
          'links are not shown.',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        security: memberSecurity,
        responses: { '200': jsonResponse('InviteList', 'The invites.'), ...authFailures },
      },
      post: {
        tags: ['Members'],
        summary: 'Invite new people with a role.',
        description:
          'By default the link lets one person join and works for 7 days. `max_uses` lets more ' +
          'people join with it (members only) and `expires_in_days` sets 1, 7 or 30 days. ' +
          'Sluby sends no email: pass the link on yourself.',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        security: memberSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/InviteRequest' } },
          },
        },
        responses: {
          '201': jsonResponse('InviteCreated', 'The invite, with its link shown only here.'),
          '400': ref('BadRequest'),
          ...authFailures,
        },
      },
    },
    '/api/v1/invites/{id}': {
      delete: {
        tags: ['Members'],
        summary: 'Withdraw a pending invite.',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        security: memberSecurity,
        parameters: [idParam('id', 'Invite id, from GET /api/v1/invites.')],
        responses: {
          '200': jsonResponse('Success', 'Withdrawn; the link no longer works.'),
          '400': badId,
          ...authFailures,
          '404': ref('NotFound'),
        },
      },
    },
    '/api/v1/keys': {
      post: {
        tags: ['Keys'],
        summary: 'Create an API key.',
        description:
          'The key belongs to the workspace and is made by the calling member, whose role it ' +
          'acts with (`created_by`); a key with no creator makes keys with no creator. The ' +
          'answer has the shape of a listed key plus `key`, the secret, which is never shown ' +
          'again.',
        'x-required-scope': 'manage',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 100,
                    description: 'Trimmed; no control characters.',
                  },
                  scopes: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string', enum: ['upload', 'read', 'manage'] },
                    default: ['upload', 'read'],
                    description: 'A scope listed twice counts once.',
                  },
                  rate_limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 100000,
                    default: 100,
                    description:
                      'Requests per minute, at most the server’s `API_KEY_RATE_LIMIT_MAX` ' +
                      '(10000 by default).',
                  },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          '201': jsonResponse('ApiKeyCreated', 'Created (the secret is shown once).'),
          '400': ref('BadRequest'),
          '409': errorWith(
            'The workspace already holds the most usable keys allowed (`API_KEYS_PER_ACCOUNT_MAX`).',
          ),
          ...authFailures,
        },
      },
      get: {
        tags: ['Keys'],
        summary: 'List API keys.',
        description:
          'Usable keys of the workspace, newest first, with who made each, including ' +
          'rotated-out keys still in their grace period. Pages hold ' +
          'up to 1000 keys; follow next_cursor while has_more is true.',
        'x-required-scope': 'manage',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 1000, default: 1000 },
          },
          { $ref: '#/components/parameters/cursor' },
        ],
        responses: {
          '200': jsonResponse('ApiKeyList', 'A page of keys.'),
          '400': ref('BadRequest'),
          ...authFailures,
        },
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
          '201': jsonResponse('ApiKeyRotated', 'The replacement key, with its secret shown once.'),
          '400': errorWith('A malformed id or grace period.'),
          '404': ref('NotFound'),
          '409': errorWith('The key was already rotated. Rotate its replacement instead.'),
          ...authFailures,
        },
      },
    },
    '/api/v1/keys/{id}': {
      patch: {
        tags: ['Keys'],
        summary: 'Rename an API key.',
        description:
          'Changes only the name; the secret, scopes and rate limit stay. An unknown key, a ' +
          'revoked key and a key past its grace period answer 404.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Key id.')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['name'],
                properties: {
                  name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 100,
                    description: 'Trimmed; no control characters.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': jsonResponse('ApiKey', 'The renamed key.'),
          '400': ref('BadRequest'),
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
      delete: {
        tags: ['Keys'],
        summary: 'Delete an API key.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Key id.')],
        responses: {
          '200': jsonResponse('Success', 'Deleted.'),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
    },

    '/api/v1/webhooks': {
      post: {
        tags: ['Webhooks'],
        summary: 'Register a webhook endpoint for the workspace.',
        description:
          'Events are delivered for the workspace’s assets. Each request carries ' +
          'X-Sluby-Event, X-Sluby-Delivery (the same on every retry of one delivery), ' +
          'X-Sluby-Timestamp (Unix seconds, per attempt) and X-Sluby-Signature-V1, the hex ' +
          'HMAC-SHA256 of `<timestamp>.<raw body>` with the endpoint secret; receivers should ' +
          'refuse a timestamp more than five minutes from their clock. X-Sluby-Signature (the HMAC ' +
          'of the body alone) is still sent but deprecated, since it does not bind a time. The body ' +
          'is `{ id, event, timestamp, data }`, where `id` identifies the event across retries. The ' +
          'URL must be http(s) and its host must resolve only to public addresses (or to the ' +
          "operator's WEBHOOK_ALLOWED_NETWORKS); this is checked again before every delivery, " +
          'redirects are not followed and response bodies are not read or stored. The secret is ' +
          'returned once.',
        'x-required-scope': 'manage',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: {
                    type: 'string',
                    format: 'uri',
                    maxLength: 2048,
                    description: 'Absolute http(s) URL on a public address.',
                  },
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
          '201': jsonResponse('WebhookCreated', 'Created; includes the signing secret once.'),
          '400': ref('BadRequest'),
          ...authFailures,
        },
      },
      get: {
        tags: ['Webhooks'],
        summary: 'List webhook endpoints.',
        description:
          'Every endpoint of the workspace, paused ones included, newest first. Needs `manage`, ' +
          'like creating them: receiver URLs often carry credentials.',
        'x-required-scope': 'manage',
        responses: {
          '200': jsonResponse('WebhookList', 'Endpoints.'),
          ...authFailures,
        },
      },
    },
    '/api/v1/webhooks/{id}/test': {
      post: {
        tags: ['Webhooks'],
        summary: 'Send a signed `webhook.test` event to the endpoint now.',
        description:
          'Delivered once, signed like any event, and recorded with the deliveries. Answers how ' +
          'the receiver responded: `delivered`, `status_code` (null when no response came) and ' +
          '`error` (why it failed, in our words).',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Endpoint id.')],
        responses: {
          '200': {
            description: 'The outcome.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    delivered: { type: 'boolean' },
                    status_code: { type: ['integer', 'null'] },
                    error: { type: ['string', 'null'] },
                  },
                  required: ['delivered', 'status_code', 'error'],
                },
              },
            },
          },
          '404': errorResponse,
        },
      },
    },
    '/api/v1/webhooks/{id}/rotate-secret': {
      post: {
        tags: ['Webhooks'],
        summary: 'Replace the signing secret of a webhook endpoint.',
        description:
          'For a secret that leaked. The old secret stops at once: every request from now on, ' +
          'retries of earlier events included, is signed with the new one, which is returned ' +
          'only here.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Endpoint id.')],
        responses: {
          '200': jsonSchemaResponse(
            {
              type: 'object',
              required: ['id', 'secret'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                secret: { type: 'string', description: 'The new signing secret, shown once.' },
              },
            },
            'The new secret.',
          ),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
    },
    '/api/v1/webhooks/{id}/deliveries': {
      get: {
        tags: ['Webhooks'],
        summary: "The endpoint's latest delivery attempts, newest first.",
        description:
          'One entry per attempt: id, event_id, event, status_code, delivered, error, attempt ' +
          '(1 for the first try), created_at, the payload that was sent, and manual (true for a ' +
          'resend). Response bodies are never stored. Attempts are kept for 30 days.',
        'x-required-scope': 'manage',
        parameters: [
          idParam('id', 'Endpoint id.'),
          {
            name: 'limit',
            in: 'query' as const,
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            description: 'How many attempts to return.',
          },
        ],
        responses: {
          '200': jsonSchemaResponse(
            {
              type: 'object',
              required: ['data'],
              properties: {
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: [
                      'id',
                      'event',
                      'status_code',
                      'delivered',
                      'error',
                      'attempt',
                      'created_at',
                      'payload',
                      'manual',
                    ],
                    properties: {
                      id: { type: 'string' },
                      event_id: nullable('string'),
                      event: { type: 'string' },
                      status_code: nullable('integer'),
                      delivered: { type: 'boolean' },
                      error: nullable('string'),
                      attempt: { type: 'integer', minimum: 1 },
                      created_at: { type: 'string', format: 'date-time' },
                      payload: {
                        type: 'object',
                        description:
                          'The JSON body that was sent: `{ id, event, timestamp, data }`.',
                      },
                      manual: {
                        type: 'boolean',
                        description: 'True for an attempt of a resend someone asked for.',
                      },
                    },
                  },
                },
              },
            },
            'Attempts.',
          ),
          '400': errorResponse,
          '404': errorResponse,
          ...authFailures,
        },
      },
    },
    '/api/v1/webhooks/{id}/deliveries/{deliveryId}/redeliver': {
      post: {
        tags: ['Webhooks'],
        summary: 'Send a logged delivery again.',
        description:
          'Queues the stored payload of the delivery again, with the same event `id` so a ' +
          'receiver that already handled it can drop the repeat. It is signed with the current ' +
          'secret, gets a new X-Sluby-Delivery id and the usual retries, and each attempt is ' +
          'logged with `manual: true`. A paused endpoint answers 409.',
        'x-required-scope': 'manage',
        parameters: [
          idParam('id', 'Endpoint id.'),
          idParam('deliveryId', 'The `id` of an entry in the delivery log.'),
        ],
        responses: {
          '202': jsonSchemaResponse(
            {
              type: 'object',
              required: ['delivery_id'],
              properties: {
                delivery_id: {
                  type: 'string',
                  description: 'The X-Sluby-Delivery header the resend carries.',
                },
              },
            },
            'Queued.',
          ),
          '400': badId,
          '404': ref('NotFound'),
          '409': errorWith('The endpoint is paused.'),
          ...authFailures,
        },
      },
    },
    '/api/v1/webhooks/{id}': {
      get: {
        tags: ['Webhooks'],
        summary: 'Get a webhook endpoint.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Endpoint id.')],
        responses: {
          '200': jsonResponse('Webhook', 'The endpoint.'),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
      patch: {
        tags: ['Webhooks'],
        summary: 'Edit, pause or resume a webhook endpoint.',
        description:
          'Send any of `url`, `events` and `is_active`. A new URL is checked like at registration. ' +
          '`is_active: false` pauses the endpoint: nothing is sent to it, and deliveries already ' +
          'queued for it are dropped. `is_active: true` resumes it for new events. The signing ' +
          'secret does not change.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Endpoint id.')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                minProperties: 1,
                properties: {
                  url: {
                    type: 'string',
                    format: 'uri',
                    maxLength: 2048,
                    description: 'Absolute http(s) URL on a public address.',
                  },
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
                    description:
                      'Replaces the subscribed events. An event listed twice counts once.',
                  },
                  is_active: { type: 'boolean', description: 'False pauses, true resumes.' },
                },
              },
            },
          },
        },
        responses: {
          '200': jsonResponse('Webhook', 'The endpoint as it is now.'),
          '400': ref('BadRequest'),
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
      delete: {
        tags: ['Webhooks'],
        summary: 'Delete a webhook endpoint.',
        'x-required-scope': 'manage',
        parameters: [idParam('id', 'Endpoint id.')],
        responses: {
          '200': jsonResponse('Success', 'Deleted.'),
          '400': badId,
          '404': ref('NotFound'),
          ...authFailures,
        },
      },
    },

    '/api/v1/reconciliation': {
      get: {
        tags: ['Reconciliation'],
        summary: 'Latest reconciliation run.',
        description:
          'Admins get the whole run, orphaned ids included; members get only the missing ' +
          'objects of the workspace’s assets (see ReconciliationRun).',
        'x-required-scope': 'manage',
        responses: {
          '200': jsonResponse('ReconciliationRun', 'Latest run.'),
          '404': errorWith('No run has completed yet.'),
          ...authFailures,
        },
      },
    },
    '/api/v1/reconciliation/run': {
      post: {
        tags: ['Reconciliation'],
        summary: 'Trigger a reconciliation run.',
        description:
          'A run scans the whole deployment, so only an admin may start one. It ' +
          'is queued unless one, manual or scheduled, is already waiting or running, so ' +
          'repeated calls never stack runs.',
        'x-required-scope': 'manage',
        'x-required-identity': 'admin',
        responses: {
          '202': jsonResponse('ReconciliationTrigger', 'Queued, or a run was already pending.'),
          ...authFailures,
        },
      },
    },

    '/api/v1/stats': {
      get: {
        tags: ['Ops'],
        summary: 'Library totals for the workspace.',
        description: 'The same totals for every member and key.',
        'x-required-scope': 'read',
        responses: { '200': jsonResponse('AssetStats', 'Totals.'), ...authFailures },
      },
    },
    '/api/v1/stats/usage': {
      get: {
        tags: ['Ops'],
        summary: 'Plays per day of the workspace’s videos.',
        description:
          'Plays of the workspace’s videos per UTC day for the last `days` days, today included, ' +
          'oldest first, with days without plays as 0. What counts as a play is described on ' +
          '`play_count` of an asset.',
        'x-required-scope': 'read',
        parameters: [
          {
            name: 'days',
            in: 'query' as const,
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 90, default: 30 },
          },
        ],
        responses: {
          '200': jsonSchemaResponse(
            {
              type: 'object',
              required: ['days', 'total'],
              properties: {
                days: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['date', 'plays'],
                    properties: {
                      date: { type: 'string', format: 'date', description: 'YYYY-MM-DD, UTC.' },
                      plays: { type: 'integer', minimum: 0 },
                    },
                  },
                },
                total: { type: 'integer', minimum: 0, description: 'Plays over all the days.' },
              },
            },
            'Plays per day.',
          ),
          '400': ref('BadRequest'),
          ...authFailures,
        },
      },
    },
    '/api/v1/system/status': {
      get: {
        tags: ['Ops'],
        summary: 'Live platform status: database, redis, Sia indexer, reconciliation, cache.',
        description: 'Admins get the full report; members a health summary (see SystemStatus).',
        'x-required-scope': 'read',
        responses: { '200': jsonResponse('SystemStatus', 'Status report.'), ...authFailures },
      },
    },
    '/api/v1/metrics': {
      get: {
        tags: ['Ops'],
        summary: 'Platform metrics (prometheus registry as JSON).',
        description: 'The registry counts the whole process, so only an admin may read it.',
        'x-required-scope': 'read',
        'x-required-identity': 'admin',
        responses: { '200': jsonResponse('Metrics', 'Metrics.'), ...authFailures },
      },
    },

    '/v1/objects/{objectId}': {
      get: {
        tags: ['Delivery'],
        summary: 'Stream a Sia object, with byte-range support.',
        description:
          'An object of a public asset needs nothing. An object of a private asset needs the ' +
          '`expires` and `sig` of a signed url (GET /api/v1/playback/{id}/signed); a manifest ' +
          'served that way has the urls of its children signed with the same expiry. Access ' +
          'follows only the asset tier: a signed playback ID gates its own /v1/stream entry, ' +
          'not these objects. HEAD answers the same headers without a body. A public answer ' +
          'carries `ETag` (the object id) and `Cache-Control: public, no-cache`, and a ' +
          'conditional request (`If-None-Match`) is answered 304 only after access is checked ' +
          'again, so a cache never keeps serving an object after its asset turns private or ' +
          'is deleted; the shipped nginx keeps small public objects for at most 60 seconds ' +
          'between checks. Objects over 8 MB are streamed and never cached.',
        security: [],
        parameters: [
          idParam('objectId', 'Sia object ID.'),
          {
            name: 'type',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['manifest', 'playlist', 'thumbnail', 'poster', 'video', 'segment', 'data'],
            },
            description: 'Content-type hint.',
          },
          {
            name: 'expires',
            in: 'query',
            schema: { type: 'integer' },
            description: 'Expiry (unix seconds) of a signed url. Required for a private object.',
          },
          {
            name: 'sig',
            in: 'query',
            schema: { type: 'string' },
            description: 'Signature of a signed url. Required for a private object.',
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
          '304': { description: 'Still public and unchanged (a conditional request).' },
          '400': errorWith('Not a Sia object id (64 lowercase hex characters).'),
          '403': errorWith(
            'A private object without a valid, unexpired signature of the asset current ' +
              'signing generation; `reason` says why.',
          ),
          '404': errorWith(
            'No asset holds the object, its asset is being deleted, or the indexer no longer ' +
              'has it.',
          ),
          '416': { description: 'Range not satisfiable.' },
          '502': errorWith('The Sia network did not answer; try again.'),
          '503': errorWith('The database did not answer; try again.'),
        },
      },
    },
    '/v1/stream/{videoAssetId}/master.m3u8': {
      get: {
        tags: ['Delivery'],
        summary: 'Master HLS manifest for an asset or playback ID.',
        description:
          'A private asset or a signed-policy playback ID needs the `expires` and `sig` of the ' +
          'asset’s signed master url; the child urls in the answer are then signed too. A ' +
          'signed playback ID gates only this entry: on a public asset its objects stay ' +
          'public, so the bytes are not private (make the asset private for that), and other ' +
          'embeds of the asset keep playing. A public answer carries an ETag and ' +
          '`public, no-cache`, but no shared cache keeps it: each 200 GET counts as a play ' +
          '(see `play_count` on an asset); HEAD and 304 do not.',
        security: [],
        parameters: [
          idParam('videoAssetId', 'Asset UUID or pb_ playback ID.'),
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
        ],
        responses: {
          '200': { description: 'HLS manifest.', content: { 'application/vnd.apple.mpegurl': {} } },
          '304': { description: 'Still public and unchanged (a conditional request).' },
          '403': errorWith('Gated, and no valid, unexpired signature; `reason` says why.'),
          '404': errorWith('No such asset or playback ID, or the asset is not ready.'),
          '502': errorWith('The Sia network did not answer; try again.'),
          '503': errorWith('The database did not answer; try again.'),
        },
      },
    },
    '/v1/share/{id}': {
      get: {
        tags: ['Delivery'],
        summary: 'Per-object sia:// share URLs for direct-from-Sia playback, without credentials.',
        description:
          'Gated like /v1/stream: a public asset by its id or a public playback ID needs ' +
          'nothing. A private asset or a signed-policy playback ID needs the `expires` and ' +
          '`sig` of its signed master URL, and the shares then never outlive `expires`. ' +
          'Expiries are capped like the authenticated route (six hours, one hour when gated) ' +
          'and rounded to five-minute slots that the server caches, so repeated calls do not ' +
          'mint again. Every map is sent `no-store` (`private, no-store` when gated): minting ' +
          'one is how a direct-from-Sia play reaches the server, and each counts as a play ' +
          '(see `play_count` on an asset), unless `renew` is set. ' +
          'Share URLs already handed out keep working until they expire, whatever happens to ' +
          'the asset meanwhile.',
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
          '503': errorWith('The database did not answer; try again.'),
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
    '/watch/{id}': {
      get: {
        tags: ['Delivery'],
        summary: "A video's public watch page, for a link or an iframe.",
        description:
          'An HTML page that plays the video by asset ID or pb_ playback ID through the gateway. ' +
          'A private video or a signed playback ID needs the `expires` and `sig` of a signed URL, ' +
          'which the page passes on to the stream and the poster. Any site may frame it ' +
          '(`frame-ancestors *`). Query `autoplay=1`, `muted=1` and `loop=1` change how it starts.',
        security: [],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Asset ID or pb_ playback ID.',
            schema: { type: 'string' },
          },
          {
            name: 'expires',
            in: 'query',
            required: false,
            description: 'From a signed URL, for a private video or a signed playback ID.',
            schema: { type: 'string' },
          },
          {
            name: 'sig',
            in: 'query',
            required: false,
            description: 'From the same signed URL.',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'The page.',
            content: { 'text/html': { schema: { type: 'string' } } },
          },
          '403': {
            description: 'The video needs a signed link, or the link expired.',
            content: { 'text/html': { schema: { type: 'string' } } },
          },
          '404': {
            description: 'No such video, or it is not ready.',
            content: { 'text/html': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/watch/assets/{file}': {
      get: {
        tags: ['Delivery'],
        summary: "The watch page's player script, hls.js build and stylesheet.",
        security: [],
        parameters: [
          {
            name: 'file',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['hls.min.js', 'watch.js', 'watch.css'] },
          },
        ],
        responses: {
          '200': { description: 'The file.' },
          '404': { description: 'No such file.' },
        },
      },
    },
  },
} as const;
