import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';
import { generateApiKey } from '../auth/api-key.js';
import { decodeCursor, type CursorKey } from '../pagination.js';
import {
  integerParam,
  keyNameSchema,
  parseOrThrow,
  RATE_LIMIT_MAX,
  stringParam,
} from '../validation.js';
import { env } from '../../config/env.js';

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  isActive: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  /** Null for keys created before prefixes were stored. */
  prefix: string | null;
  lastUsedAt: Date | null;
}

export interface KeyRouteDeps {
  /** Null when the account already holds `maxKeys` usable keys. */
  createApiKey: (
    data: {
      keyHash: string;
      prefix: string;
      name: string;
      scopes: string[];
      rateLimit: number;
      creatorAddress: string;
    },
    maxKeys: number,
  ) => Promise<ApiKeyRecord | null>;
  /**
   * One page of active, unexpired keys, newest first (keys inside a rotation
   * grace period included). `owner` undefined lists every account.
   */
  listApiKeys: (
    owner: string | undefined,
    page: { limit: number; cursor?: CursorKey },
  ) => Promise<{ data: ApiKeyRecord[]; hasMore: boolean; nextCursor: string | null }>;
  /** Renames a usable key of `owner`; null when there is none. */
  renameApiKey: (
    id: string,
    owner: string | undefined,
    name: string,
  ) => Promise<ApiKeyRecord | null>;
  /** Deletes only if the key belongs to `owner`; false when it does not. */
  deleteApiKey: (id: string, owner?: string) => Promise<boolean>;
  /**
   * Issue a replacement for key `id` with the same name, scopes and rate limit,
   * and make the old key expire at `retireAt`. Atomic. Null when the key does
   * not exist, is not owned, or is already retired.
   */
  rotateApiKey: (
    id: string,
    owner: string | undefined,
    replacement: { keyHash: string; prefix: string },
    retireAt: Date,
  ) => Promise<
    | { status: 'rotated'; replacement: ApiKeyRecord; retiredAt: Date }
    | { status: 'not_found' }
    | { status: 'already_rotated'; replacedById: string | null }
  >;
}

const VALID_SCOPES = ['upload', 'read', 'manage'] as const;
// high enough that the Studio, which does not page, sees every key of any
// realistic account; has_more says when it does not
const LIST_LIMIT_MAX = 1000;
// a week is enough to roll a key out to every deployment that holds it
const MAX_GRACE_SECONDS = 7 * 24 * 60 * 60;

function formatKey(k: ApiKeyRecord) {
  return {
    id: k.id,
    name: k.name,
    scopes: k.scopes,
    rate_limit: k.rateLimit,
    is_active: k.isActive,
    created_at: k.createdAt.toISOString(),
    expires_at: k.expiresAt ? k.expiresAt.toISOString() : null,
    prefix: k.prefix,
    last_used_at: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
  };
}

const createBodySchema = z
  .object({
    name: keyNameSchema,
    scopes: z
      .array(z.enum(VALID_SCOPES, { message: `scopes must be from: ${VALID_SCOPES.join(', ')}` }), {
        message: 'scopes must be a non-empty array of strings',
      })
      .min(1, { message: 'scopes must be a non-empty array of strings' })
      .optional(),
    rate_limit: z
      .number({ message: 'rate_limit must be a number' })
      .int({ message: 'rate_limit must be an integer' })
      .min(1, { message: `rate_limit must be from 1 to ${RATE_LIMIT_MAX}` })
      .max(RATE_LIMIT_MAX, { message: `rate_limit must be from 1 to ${RATE_LIMIT_MAX}` })
      .optional(),
  })
  .strict();

const updateBodySchema = z.object({ name: keyNameSchema }).strict();

const listQuerySchema = z.object({
  limit: integerParam('limit', 1, LIST_LIMIT_MAX).optional(),
  cursor: stringParam('cursor').optional(),
});

export interface KeyLimits {
  /** The highest rate_limit a new key may ask for. */
  rateLimitMax: number;
  /** How many usable keys one account may hold. */
  keysPerAccountMax: number;
}

export function createKeyRoutes(
  deps: KeyRouteDeps,
  limits: KeyLimits = {
    rateLimitMax: env.API_KEY_RATE_LIMIT_MAX,
    keysPerAccountMax: env.API_KEYS_PER_ACCOUNT_MAX,
  },
): Router {
  const router = Router();

  /**
   * POST /api/v1/keys
   * Create an API key for the caller's account. The raw key is returned once.
   */
  router.post('/', requireScope('manage'), async (req: Request, res: Response) => {
    const body = parseOrThrow(createBodySchema, req.body ?? {});
    // a scope listed twice means the same as once
    const scopes = [...new Set(body.scopes ?? ['upload', 'read'])];

    const rateLimit = body.rate_limit ?? 100;
    if (rateLimit > limits.rateLimitMax) {
      throw new AppError(400, `rate_limit must be at most ${limits.rateLimitMax}`);
    }

    const { key, hash, prefix } = generateApiKey();
    const created = await deps.createApiKey(
      {
        keyHash: hash,
        prefix,
        name: body.name,
        scopes,
        rateLimit,
        creatorAddress: req.apiKey!.creatorAddress,
      },
      limits.keysPerAccountMax,
    );
    if (!created) {
      throw new AppError(
        409,
        `This account already has ${limits.keysPerAccountMax} API keys, the most allowed. ` +
          'Revoke one you no longer use, then try again.',
      );
    }

    // the listing shape plus the secret, which is only ever shown here
    res.status(201).json({ ...formatKey(created), key });
  });

  /**
   * GET /api/v1/keys
   * The caller's usable keys, newest first. A key being rotated out stays
   * listed, with its expires_at, until its grace period ends. The platform
   * identity lists every account's keys, as it can rotate and delete them.
   */
  router.get('/', requireScope('manage'), async (req: Request, res: Response) => {
    const q = parseOrThrow(listQuerySchema, req.query);
    let cursor: CursorKey | undefined;
    if (q.cursor !== undefined) {
      cursor = decodeCursor(q.cursor) ?? undefined;
      if (!cursor) throw new AppError(400, 'cursor is not valid; start again without it');
    }
    const page = await deps.listApiKeys(ownerFilter(req.apiKey!.creatorAddress), {
      limit: q.limit ?? LIST_LIMIT_MAX,
      cursor,
    });
    res.json({
      data: page.data.map(formatKey),
      has_more: page.hasMore,
      next_cursor: page.nextCursor,
      // so a form can check a new key against them before sending it
      limits: { max_keys: limits.keysPerAccountMax, max_rate_limit: limits.rateLimitMax },
    });
  });

  /**
   * POST /api/v1/keys/:id/rotate
   * Replace a key: a new secret with the same name, scopes and rate limit.
   * The old key stops working immediately, or after `grace_period_seconds`
   * (up to a week) so deployments can switch over without downtime. A key
   * that was already rotated is refused with 409: rotate its replacement.
   */
  router.post('/:id/rotate', requireScope('manage'), async (req: Request, res: Response) => {
    const grace = req.body?.grace_period_seconds ?? 0;
    if (!Number.isInteger(grace) || grace < 0 || grace > MAX_GRACE_SECONDS) {
      throw new AppError(
        400,
        `grace_period_seconds must be an integer from 0 to ${MAX_GRACE_SECONDS}`,
      );
    }
    const id = String(req.params.id);
    // rotating the key you are calling with is fine: the request is already
    // authenticated, and the grace period decides how long it keeps working

    const { key, hash, prefix } = generateApiKey();
    const result = await deps.rotateApiKey(
      id,
      ownerFilter(req.apiKey!.creatorAddress),
      { keyHash: hash, prefix },
      new Date(Date.now() + grace * 1000),
    );
    if (result.status === 'not_found') {
      throw new AppError(404, 'API key not found');
    }
    if (result.status === 'already_rotated') {
      throw new AppError(409, 'This key was already rotated. Rotate its replacement instead.');
    }

    res.status(201).json({
      ...formatKey(result.replacement),
      key, // only shown once
      rotated_from: id,
      previous_key_expires_at: result.retiredAt.toISOString(),
    });
  });

  /**
   * PATCH /api/v1/keys/:id
   * Rename a key. Its secret, scopes and limit stay as they are.
   */
  router.patch('/:id', requireScope('manage'), async (req: Request, res: Response) => {
    const body = parseOrThrow(updateBodySchema, req.body ?? {});
    const updated = await deps.renameApiKey(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
      body.name,
    );
    if (!updated) throw new AppError(404, 'API key not found');
    res.json(formatKey(updated));
  });

  /**
   * DELETE /api/v1/keys/:id
   * Revoke a key now. Scoped to the caller's account.
   */
  router.delete('/:id', requireScope('manage'), async (req: Request, res: Response) => {
    const deleted = await deps.deleteApiKey(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );
    if (!deleted) {
      throw new AppError(404, 'API key not found');
    }
    res.json({ success: true });
  });

  return router;
}
