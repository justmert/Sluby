import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';
import { generateApiKey } from '../auth/api-key.js';

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  isActive: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface KeyRouteDeps {
  createApiKey: (data: {
    keyHash: string;
    name: string;
    scopes: string[];
    rateLimit: number;
    creatorAddress: string;
  }) => Promise<{ id: string }>;
  /** Active, unexpired keys of the account (keys inside a rotation grace period included). */
  listApiKeys: (creatorAddress: string) => Promise<ApiKeyRecord[]>;
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
    replacement: { keyHash: string },
    retireAt: Date,
  ) => Promise<{ replacement: ApiKeyRecord; retiredAt: Date } | null>;
}

const VALID_SCOPES = ['upload', 'read', 'manage'];
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
  };
}

export function createKeyRoutes(deps: KeyRouteDeps): Router {
  const router = Router();

  /**
   * POST /api/v1/keys
   * Create an API key for the caller's account. The raw key is returned once.
   */
  router.post('/', requireScope('manage'), async (req: Request, res: Response) => {
    const { name, scopes, rate_limit } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError(400, 'Name is required');
    }

    const requestedScopes = scopes ?? ['upload', 'read'];
    // Guard the type before filtering: a non-array `scopes` (e.g. a bare
    // string) would otherwise throw on .filter and surface as a 500.
    if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
      throw new AppError(400, 'scopes must be a non-empty array of strings');
    }
    const invalidScopes = requestedScopes.filter(
      (s: unknown) => !VALID_SCOPES.includes(s as string),
    );
    if (invalidScopes.length > 0) {
      throw new AppError(400, `Invalid scopes: ${invalidScopes.join(', ')}`);
    }

    // rate_limit reaches an integer DB column, so reject junk up front
    // rather than letting Postgres raise a 500.
    const rateLimit = rate_limit ?? 100;
    if (!Number.isInteger(rateLimit) || rateLimit <= 0) {
      throw new AppError(400, 'rate_limit must be a positive integer');
    }

    const { key, hash } = generateApiKey();
    const result = await deps.createApiKey({
      keyHash: hash,
      name: name.trim(),
      scopes: requestedScopes,
      rateLimit,
      creatorAddress: req.apiKey!.creatorAddress,
    });

    res.status(201).json({
      id: result.id,
      key, // only shown once
      name: name.trim(),
      scopes: requestedScopes,
      rate_limit: rateLimit,
    });
  });

  /**
   * GET /api/v1/keys
   * The caller's usable keys. A key being rotated out stays listed, with its
   * expires_at, until its grace period ends.
   */
  router.get('/', requireScope('manage'), async (req: Request, res: Response) => {
    const keys = await deps.listApiKeys(req.apiKey!.creatorAddress);
    res.json({ data: keys.map(formatKey) });
  });

  /**
   * POST /api/v1/keys/:id/rotate
   * Replace a key: a new secret with the same name, scopes and rate limit.
   * The old key stops working immediately, or after `grace_period_seconds`
   * (up to a week) so deployments can switch over without downtime.
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

    const { key, hash } = generateApiKey();
    const result = await deps.rotateApiKey(
      id,
      ownerFilter(req.apiKey!.creatorAddress),
      { keyHash: hash },
      new Date(Date.now() + grace * 1000),
    );
    if (!result) {
      throw new AppError(404, 'API key not found');
    }

    res.status(201).json({
      ...formatKey(result.replacement),
      key, // only shown once
      rotated_from: id,
      previous_key_expires_at: result.retiredAt.toISOString(),
    });
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
