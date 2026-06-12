import { Router, type Request, type Response } from 'express';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../../config/logger.js';

// ──────────────────────────────────────────
// Dependency types
// ──────────────────────────────────────────

export interface AccessControlRouteDeps {
  // DB persistence
  createAllowlistRecord: (data: {
    videoAssetId: string;
    name: string;
    creatorAddress: string;
  }) => Promise<{ id: string }>;

  listAllowlists: (creatorAddress?: string) => Promise<Array<{
    id: string;
    videoAssetId: string;
    name: string;
    creatorAddress: string;
    createdAt: Date;
    members: Array<{ address: string }>;
  }>>;

  deleteAllowlistRecord: (id: string) => Promise<void>;

  addAllowlistMemberRecord: (allowlistId: string, address: string) => Promise<{ id: string }>;

  removeAllowlistMemberRecord: (allowlistId: string, address: string) => Promise<void>;

  createSubscriptionRecord: (data: {
    subscriberAddress: string;
    creatorAddress: string;
    tier: number;
    durationDays: number;
    expiresAt: Date;
  }) => Promise<{ id: string }>;

  listSubscriptions: (creatorAddress?: string) => Promise<Array<{
    id: string;
    subscriberAddress: string;
    creatorAddress: string;
    tier: number;
    durationDays: number;
    expiresAt: Date;
    createdAt: Date;
  }>>;

  createViewingTicketRecord: (data: {
    viewerAddress: string;
    videoAssetId: string;
    creatorAddress: string;
  }) => Promise<{ id: string }>;

  listViewingTickets: (creatorAddress?: string) => Promise<Array<{
    id: string;
    viewerAddress: string;
    videoAssetId: string;
    creatorAddress: string;
    createdAt: Date;
  }>>;
}

// ──────────────────────────────────────────
// Route factory
// ──────────────────────────────────────────

export function createAccessControlRoutes(deps: AccessControlRouteDeps): Router {
  const router = Router();

  // ── Allowlists ──

  /**
   * GET /api/v1/access-control/allowlists
   * List all allowlists for the authenticated creator.
   */
  router.get('/allowlists', async (req: Request, res: Response) => {
    const creatorAddress = req.apiKey?.creatorAddress;
    const records = await deps.listAllowlists(creatorAddress);

    res.json(
      records.map((al) => ({
        id: al.id,
        name: al.name,
        video_id: al.videoAssetId,
        allowed: al.members.map((m) => m.address),
        created_at: al.createdAt.toISOString(),
      })),
    );
  });

  /**
   * POST /api/v1/access-control/allowlists
   * Create a new allowlist for private video access control.
   */
  router.post('/allowlists', async (req: Request, res: Response) => {
    const { video_asset_id, name, initial_addresses } = req.body;
    const creatorAddress = req.apiKey?.creatorAddress ?? '';

    if (!video_asset_id) {
      throw new AppError(400, 'video_asset_id is required');
    }
    if (!name) {
      throw new AppError(400, 'name is required');
    }

    try {
      // Persist to DB
      const record = await deps.createAllowlistRecord({
        videoAssetId: video_asset_id,
        name,
        creatorAddress,
      });

      // Persist initial members
      const addrs: string[] = initial_addresses ?? [];
      for (const addr of addrs) {
        await deps.addAllowlistMemberRecord(record.id, addr);
      }

      res.status(201).json({
        id: record.id,
        name,
        video_id: video_asset_id,
        allowed: addrs,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to create allowlist');
      throw new AppError(500, 'Failed to create allowlist');
    }
  });

  /**
   * DELETE /api/v1/access-control/allowlists/:id
   * Delete an allowlist.
   */
  router.delete('/allowlists/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    try {
      await deps.deleteAllowlistRecord(id);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err, id }, 'Failed to delete allowlist');
      throw new AppError(500, 'Failed to delete allowlist');
    }
  });

  /**
   * POST /api/v1/access-control/allowlists/:id/members
   * Add an address to an existing allowlist.
   */
  router.post('/allowlists/:id/members', async (req: Request, res: Response) => {
    const { address } = req.body;
    const allowlistId = String(req.params.id);

    if (!address) {
      throw new AppError(400, 'address is required');
    }

    try {
      await deps.addAllowlistMemberRecord(allowlistId, address);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err, allowlistId, address }, 'Failed to add member to allowlist');
      throw new AppError(500, 'Failed to add member to allowlist');
    }
  });

  /**
   * DELETE /api/v1/access-control/allowlists/:id/members/:address
   * Remove an address from an allowlist.
   */
  router.delete('/allowlists/:id/members/:address', async (req: Request, res: Response) => {
    const allowlistId = String(req.params.id);
    const address = decodeURIComponent(String(req.params.address));

    try {
      await deps.removeAllowlistMemberRecord(allowlistId, address);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err, allowlistId, address }, 'Failed to remove member from allowlist');
      throw new AppError(500, 'Failed to remove member from allowlist');
    }
  });

  // ── Subscriptions ──

  /**
   * GET /api/v1/access-control/subscriptions
   * List all subscriptions for the authenticated creator.
   */
  router.get('/subscriptions', async (req: Request, res: Response) => {
    const creatorAddress = req.apiKey?.creatorAddress;
    const records = await deps.listSubscriptions(creatorAddress);

    res.json(
      records.map((sub) => ({
        id: sub.id,
        subscriber: sub.subscriberAddress,
        creator: sub.creatorAddress,
        tier: sub.tier,
        expires_at: sub.expiresAt.toISOString(),
        created_at: sub.createdAt.toISOString(),
      })),
    );
  });

  /**
   * POST /api/v1/access-control/subscriptions
   * Create a subscription pass for a subscriber.
   */
  router.post('/subscriptions', async (req: Request, res: Response) => {
    const { subscriber_address, duration_days, tier } = req.body;
    const creatorAddress = req.apiKey?.creatorAddress ?? '';

    if (!subscriber_address) {
      throw new AppError(400, 'subscriber_address is required');
    }
    if (!duration_days || duration_days <= 0) {
      throw new AppError(400, 'duration_days must be a positive number');
    }

    const durationMs = duration_days * 24 * 60 * 60 * 1000;
    const subscriptionTier = tier ?? 0;
    const expiresAt = new Date(Date.now() + durationMs);

    try {
      const record = await deps.createSubscriptionRecord({
        subscriberAddress: subscriber_address,
        creatorAddress,
        tier: subscriptionTier,
        durationDays: duration_days,
        expiresAt,
      });

      res.status(201).json({
        id: record.id,
        subscriber: subscriber_address,
        expires_at: expiresAt.toISOString(),
        tier: subscriptionTier,
      });
    } catch (err) {
      logger.error({ err, subscriber_address }, 'Failed to create subscription');
      throw new AppError(500, 'Failed to create subscription');
    }
  });

  // ── Viewing Tickets ──

  /**
   * GET /api/v1/access-control/tickets
   * List all viewing tickets for the authenticated creator.
   */
  router.get('/tickets', async (req: Request, res: Response) => {
    const creatorAddress = req.apiKey?.creatorAddress;
    const records = await deps.listViewingTickets(creatorAddress);

    res.json(
      records.map((ticket) => ({
        id: ticket.id,
        viewer: ticket.viewerAddress,
        video_id: ticket.videoAssetId,
        created_at: ticket.createdAt.toISOString(),
      })),
    );
  });

  /**
   * POST /api/v1/access-control/tickets
   * Create a viewing ticket for a viewer.
   */
  router.post('/tickets', async (req: Request, res: Response) => {
    const { viewer_address, video_asset_id } = req.body;
    const creatorAddress = req.apiKey?.creatorAddress ?? '';

    if (!viewer_address) {
      throw new AppError(400, 'viewer_address is required');
    }
    if (!video_asset_id) {
      throw new AppError(400, 'video_asset_id is required');
    }

    try {
      const record = await deps.createViewingTicketRecord({
        viewerAddress: viewer_address,
        videoAssetId: video_asset_id,
        creatorAddress,
      });

      res.status(201).json({
        id: record.id,
        viewer: viewer_address,
        video_id: video_asset_id,
      });
    } catch (err) {
      logger.error({ err, viewer_address, video_asset_id }, 'Failed to create viewing ticket');
      throw new AppError(500, 'Failed to create viewing ticket');
    }
  });

  return router;
}
